package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func newTrashTestHandler(t *testing.T) *Handler {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "trash", "alice"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	return &Handler{dataRoot: root}
}

func TestTrashMeta_RoundTrip(t *testing.T) {
	h := newTrashTestHandler(t)

	items := map[string]TrashItem{
		"id-1": {ID: "id-1", Name: "a.txt", DeletedAt: time.Now()},
	}
	if err := h.saveTrashMeta("alice", items); err != nil {
		t.Fatalf("saveTrashMeta: %v", err)
	}

	loaded, err := h.loadTrashMeta("alice")
	if err != nil {
		t.Fatalf("loadTrashMeta: %v", err)
	}
	if len(loaded) != 1 || loaded["id-1"].Name != "a.txt" {
		t.Errorf("loaded = %+v", loaded)
	}
}

// Callers use `meta, _ := h.loadTrashMeta(...)` and then assign into the map.
// A nil map would panic on assignment, so load must never hand one back.
func TestTrashMeta_LoadNeverReturnsNilMap(t *testing.T) {
	h := newTrashTestHandler(t)

	meta, err := h.loadTrashMeta("alice")
	if err != nil {
		t.Fatalf("loadTrashMeta on a fresh user: %v", err)
	}
	if meta == nil {
		t.Fatal("loadTrashMeta returned a nil map for a user with no trash")
	}
	meta["x"] = TrashItem{ID: "x"} // would panic on a nil map

	metaPath := h.getTrashMetaPath("alice")
	if err := os.WriteFile(metaPath, []byte("{ this is not json"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	meta, _ = h.loadTrashMeta("alice")
	if meta == nil {
		t.Fatal("loadTrashMeta returned a nil map for a corrupt index")
	}
	meta["y"] = TrashItem{ID: "y"}

	if err := os.Remove(metaPath); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if err := os.Mkdir(metaPath, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	meta, err = h.loadTrashMeta("alice")
	if meta == nil {
		t.Fatalf("loadTrashMeta returned a nil map alongside err=%v", err)
	}
	meta["z"] = TrashItem{ID: "z"}
}

// The index is rewritten in full on every change. A partial write used to be
// able to destroy the whole listing; writing through a temp file and renaming
// means a reader sees either the old file or the new one.
func TestTrashMeta_WriteIsAtomic(t *testing.T) {
	h := newTrashTestHandler(t)

	if err := h.saveTrashMeta("alice", map[string]TrashItem{"id-1": {ID: "id-1", Name: "first.txt"}}); err != nil {
		t.Fatalf("saveTrashMeta: %v", err)
	}
	if err := h.saveTrashMeta("alice", map[string]TrashItem{"id-2": {ID: "id-2", Name: "second.txt"}}); err != nil {
		t.Fatalf("saveTrashMeta: %v", err)
	}

	entries, err := os.ReadDir(filepath.Dir(h.getTrashMetaPath("alice")))
	if err != nil {
		t.Fatalf("readdir: %v", err)
	}
	// The index itself is a dotfile, so match the temp prefix specifically.
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".trash-meta-") {
			t.Errorf("temp file left behind: %s", e.Name())
		}
	}

	data, err := os.ReadFile(h.getTrashMetaPath("alice"))
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var parsed map[string]TrashItem
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("index does not parse after rewrite: %v", err)
	}
	if _, ok := parsed["id-2"]; !ok {
		t.Error("the second write did not land")
	}
}

// Concurrent deletes used to read-modify-write the same file with no lock, so
// one could drop the other's entry.
func TestTrashMeta_ConcurrentUpdatesDoNotLoseEntries(t *testing.T) {
	h := newTrashTestHandler(t)

	if err := h.saveTrashMeta("alice", map[string]TrashItem{}); err != nil {
		t.Fatalf("seed: %v", err)
	}

	const n = 40
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := fmt.Sprintf("id-%d", i)
			if err := h.updateTrashMeta("alice", func(m map[string]TrashItem) {
				m[id] = TrashItem{ID: id, Name: id + ".txt"}
			}); err != nil {
				t.Errorf("updateTrashMeta: %v", err)
			}
		}(i)
	}
	wg.Wait()

	final, err := h.loadTrashMeta("alice")
	if err != nil {
		t.Fatalf("loadTrashMeta: %v", err)
	}
	if len(final) != n {
		t.Errorf("index holds %d entries after %d concurrent adds; entries were lost", len(final), n)
	}
}

func TestTrashMeta_SaveHandlesNilMap(t *testing.T) {
	h := newTrashTestHandler(t)

	if err := h.saveTrashMeta("alice", nil); err != nil {
		t.Fatalf("saveTrashMeta(nil): %v", err)
	}
	loaded, err := h.loadTrashMeta("alice")
	if err != nil {
		t.Fatalf("loadTrashMeta: %v", err)
	}
	if loaded == nil || len(loaded) != 0 {
		t.Errorf("loaded = %+v, want an empty map", loaded)
	}
}
