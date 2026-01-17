package handlers

import (
	"context"
	"database/sql"
	"fmt"
)

// TxFunc is a function that runs within a transaction
type TxFunc func(tx *sql.Tx) error

// WithTransaction executes a function within a database transaction
// If the function returns an error, the transaction is rolled back
// Otherwise, the transaction is committed
func WithTransaction(db *sql.DB, fn TxFunc) error {
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p) // Re-throw panic after rollback
		}
	}()

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("tx failed: %v, rollback failed: %w", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// WithTransactionContext executes a function within a database transaction with context
func WithTransactionContext(ctx context.Context, db *sql.DB, fn TxFunc) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback()
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(); rbErr != nil {
			return fmt.Errorf("tx failed: %v, rollback failed: %w", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}

// TransactionalAuditLog logs an audit event within a transaction
func TransactionalAuditLog(tx *sql.Tx, actorID, eventType, targetResource string, ipAddr string, details map[string]interface{}) error {
	query := `
		INSERT INTO audit_logs (actor_id, event_type, target_resource, ip_addr, details)
		VALUES ($1, $2, $3, $4::inet, $5)
	`

	var detailsJSON interface{}
	if details != nil {
		detailsJSON = details
	}

	var actorIDPtr interface{}
	if actorID != "" {
		actorIDPtr = actorID
	}

	_, err := tx.Exec(query, actorIDPtr, eventType, targetResource, ipAddr, detailsJSON)
	return err
}

// BatchOperation represents a batch of database operations
type BatchOperation struct {
	db         *sql.DB
	operations []TxFunc
}

// NewBatchOperation creates a new batch operation
func NewBatchOperation(db *sql.DB) *BatchOperation {
	return &BatchOperation{
		db:         db,
		operations: make([]TxFunc, 0),
	}
}

// Add adds an operation to the batch
func (b *BatchOperation) Add(op TxFunc) *BatchOperation {
	b.operations = append(b.operations, op)
	return b
}

// Execute executes all operations in a single transaction
func (b *BatchOperation) Execute() error {
	if len(b.operations) == 0 {
		return nil
	}

	return WithTransaction(b.db, func(tx *sql.Tx) error {
		for _, op := range b.operations {
			if err := op(tx); err != nil {
				return err
			}
		}
		return nil
	})
}

// SharedFolderTransaction handles shared folder operations atomically
type SharedFolderTransaction struct {
	db *sql.DB
}

// NewSharedFolderTransaction creates a new shared folder transaction handler
func NewSharedFolderTransaction(db *sql.DB) *SharedFolderTransaction {
	return &SharedFolderTransaction{db: db}
}

// CreateWithMembers creates a shared folder and adds initial members atomically
func (s *SharedFolderTransaction) CreateWithMembers(
	name, description string,
	quota int64,
	createdBy string,
	members []struct {
		UserID     string
		Permission int
	},
) (string, error) {
	var folderID string

	err := WithTransaction(s.db, func(tx *sql.Tx) error {
		// Create shared folder
		err := tx.QueryRow(`
			INSERT INTO shared_folders (name, description, storage_quota, created_by)
			VALUES ($1, $2, $3, $4)
			RETURNING id
		`, name, description, quota, createdBy).Scan(&folderID)
		if err != nil {
			return fmt.Errorf("failed to create shared folder: %w", err)
		}

		// Add members
		for _, member := range members {
			_, err := tx.Exec(`
				INSERT INTO shared_folder_members (shared_folder_id, user_id, permission_level, added_by)
				VALUES ($1, $2, $3, $4)
			`, folderID, member.UserID, member.Permission, createdBy)
			if err != nil {
				return fmt.Errorf("failed to add member %s: %w", member.UserID, err)
			}
		}

		return nil
	})

	return folderID, err
}

// DeleteWithCleanup deletes a shared folder and all related data atomically
func (s *SharedFolderTransaction) DeleteWithCleanup(folderID string) error {
	return WithTransaction(s.db, func(tx *sql.Tx) error {
		// Delete members first (foreign key)
		_, err := tx.Exec(`DELETE FROM shared_folder_members WHERE shared_folder_id = $1`, folderID)
		if err != nil {
			return fmt.Errorf("failed to delete members: %w", err)
		}

		// Delete the folder
		result, err := tx.Exec(`DELETE FROM shared_folders WHERE id = $1`, folderID)
		if err != nil {
			return fmt.Errorf("failed to delete folder: %w", err)
		}

		rows, _ := result.RowsAffected()
		if rows == 0 {
			return fmt.Errorf("shared folder not found")
		}

		return nil
	})
}

// UserTransaction handles user-related operations atomically
type UserTransaction struct {
	db *sql.DB
}

// NewUserTransaction creates a new user transaction handler
func NewUserTransaction(db *sql.DB) *UserTransaction {
	return &UserTransaction{db: db}
}

// DeleteWithCleanup deletes a user and all related data atomically
func (u *UserTransaction) DeleteWithCleanup(userID string) error {
	return WithTransaction(u.db, func(tx *sql.Tx) error {
		// Delete file shares
		_, err := tx.Exec(`DELETE FROM file_shares WHERE owner_id = $1 OR shared_with_id = $1`, userID)
		if err != nil {
			return fmt.Errorf("failed to delete file shares: %w", err)
		}

		// Delete shared folder memberships
		_, err = tx.Exec(`DELETE FROM shared_folder_members WHERE user_id = $1`, userID)
		if err != nil {
			return fmt.Errorf("failed to delete folder memberships: %w", err)
		}

		// Delete shares created by user
		_, err = tx.Exec(`DELETE FROM shares WHERE created_by = $1`, userID)
		if err != nil {
			return fmt.Errorf("failed to delete shares: %w", err)
		}

		// Delete the user
		result, err := tx.Exec(`DELETE FROM users WHERE id = $1`, userID)
		if err != nil {
			return fmt.Errorf("failed to delete user: %w", err)
		}

		rows, _ := result.RowsAffected()
		if rows == 0 {
			return fmt.Errorf("user not found")
		}

		return nil
	})
}
