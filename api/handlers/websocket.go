package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// getAllowedOrigins returns the list of allowed origins for WebSocket connections
func getAllowedOrigins() []string {
	origins := os.Getenv("ALLOWED_ORIGINS")
	if origins == "" {
		// Development defaults - allow common local development ports
		return []string{
			"http://localhost:3000",
			"http://localhost:3080",
			"http://localhost:5173",
			"http://127.0.0.1:3000",
			"http://127.0.0.1:3080",
			"http://127.0.0.1:5173",
		}
	}
	return strings.Split(origins, ",")
}

// isOriginAllowed checks if the origin is in the allowed list
func isOriginAllowed(origin string) bool {
	if origin == "" {
		// Allow same-origin requests (no Origin header)
		return true
	}

	allowedOrigins := getAllowedOrigins()

	// Parse origin to normalize it
	parsedOrigin, err := url.Parse(origin)
	if err != nil {
		return false
	}

	normalizedOrigin := parsedOrigin.Scheme + "://" + parsedOrigin.Host

	for _, allowed := range allowedOrigins {
		allowed = strings.TrimSpace(allowed)
		// Check exact match
		if normalizedOrigin == allowed {
			return true
		}
		// Check wildcard match (e.g., "*.example.com")
		if strings.HasPrefix(allowed, "*.") {
			suffix := allowed[1:] // ".example.com"
			if strings.HasSuffix(parsedOrigin.Host, suffix) {
				return true
			}
		}
	}

	// In development mode, be more permissive
	if os.Getenv("SCV_ENV") != "production" {
		log.Printf("WARNING: WebSocket connection from non-allowed origin: %s (allowed in development)", origin)
		return true
	}

	log.Printf("SECURITY: Rejected WebSocket connection from origin: %s", origin)
	return false
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		return isOriginAllowed(origin)
	},
}

// FileChangeEvent represents a file change notification
type FileChangeEvent struct {
	Type      string `json:"type"`      // "create", "write", "remove", "rename"
	Path      string `json:"path"`      // Virtual path (e.g., /home/file.txt)
	Name      string `json:"name"`      // File/folder name
	IsDir     bool   `json:"isDir"`     // Whether it's a directory
	Timestamp int64  `json:"timestamp"` // Unix timestamp
}

// Client represents a WebSocket client
type Client struct {
	conn       *websocket.Conn
	send       chan []byte
	username   string
	watchPaths []string // Virtual paths this client is watching
}

// Hub maintains the set of active clients and broadcasts messages
type Hub struct {
	clients    map[*Client]bool
	broadcast  chan FileChangeEvent
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

var hub = &Hub{
	clients:    make(map[*Client]bool),
	broadcast:  make(chan FileChangeEvent, 100),
	register:   make(chan *Client),
	unregister: make(chan *Client),
}

func init() {
	go hub.run()
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("[WebSocket] Client connected: %s", client.username)

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				log.Printf("[WebSocket] Client disconnected: %s", client.username)
			}
			h.mu.Unlock()

		case event := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				// Check if client is watching this path
				if h.shouldNotify(client, event.Path) {
					select {
					case client.send <- mustMarshal(event):
					default:
						// Client buffer full, skip
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) shouldNotify(client *Client, path string) bool {
	// Get the parent directory of the changed file
	parentPath := filepath.Dir(path)

	for _, watchPath := range client.watchPaths {
		// Direct match or parent directory match
		if path == watchPath || parentPath == watchPath || strings.HasPrefix(path, watchPath+"/") {
			return true
		}
	}
	return false
}

func mustMarshal(v interface{}) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		return []byte("{}")
	}
	return data
}

// BroadcastFileChange sends a file change event to all relevant clients
func BroadcastFileChange(event FileChangeEvent) {
	select {
	case hub.broadcast <- event:
	default:
		log.Printf("[WebSocket] Broadcast channel full, dropping event")
	}
}

// HandleWebSocket handles WebSocket connections for file change notifications
func (h *Handler) HandleWebSocket(c echo.Context) error {
	// Get token from query parameter (WebSocket connections can't use Authorization header)
	tokenString := c.QueryParam("token")
	if tokenString == "" {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Authentication required",
		})
	}

	// Parse and validate the JWT token
	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "scv-default-secret-change-in-production"
	}

	token, err := jwt.ParseWithClaims(tokenString, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid token",
		})
	}

	claims, ok := token.Claims.(*JWTClaims)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{
			"error": "Invalid token claims",
		})
	}

	conn, err := upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Printf("[WebSocket] Upgrade error: %v", err)
		return err
	}

	client := &Client{
		conn:       conn,
		send:       make(chan []byte, 256),
		username:   claims.Username,
		watchPaths: []string{"/home", "/shared"}, // Default watch paths
	}

	hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()

	return nil
}

func (c *Client) readPump() {
	defer func() {
		hub.unregister <- c
		c.conn.Close()
	}()

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("[WebSocket] Read error: %v", err)
			}
			break
		}

		// Handle incoming messages (e.g., subscribe to specific paths)
		var msg struct {
			Type  string   `json:"type"`
			Paths []string `json:"paths"`
		}
		if err := json.Unmarshal(message, &msg); err == nil {
			if msg.Type == "subscribe" && len(msg.Paths) > 0 {
				c.watchPaths = msg.Paths
				log.Printf("[WebSocket] Client %s subscribed to: %v", c.username, msg.Paths)
			}
		}
	}
}

func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()

	for {
		message, ok := <-c.send
		if !ok {
			c.conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}

		if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
			return
		}
	}
}
