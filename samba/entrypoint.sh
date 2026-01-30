#!/bin/bash
set -e

SYNC_FILE="/etc/filehatch/smb_users.txt"
SYNC_DIR="/etc/filehatch"
AUDIT_LOG="/etc/filehatch/smb_audit.log"

echo "[FileHatch-Samba] Starting user sync service..."

# SMB configuration priority:
# 1. User custom config with recycle settings at /etc/filehatch/smb.conf
# 2. Default template from /smb.conf.template (also used if old config without recycle)
USER_SMB_CONF="/etc/filehatch/smb.conf"
if [ -s "$USER_SMB_CONF" ]; then
    # Check if config has recycle settings (new format with trash integration)
    if grep -q "vfs objects.*recycle" "$USER_SMB_CONF" 2>/dev/null; then
        echo "[FileHatch-Samba] Using custom smb.conf from $USER_SMB_CONF (recycle enabled)"
        cat "$USER_SMB_CONF" > /etc/samba/smb.conf
    else
        # Old format without recycle settings - auto-upgrade with backup
        echo "[FileHatch-Samba] Detected old smb.conf format (no recycle bin settings)"
        BACKUP_FILE="${USER_SMB_CONF}.bak.$(date +%Y%m%d%H%M%S)"
        cp "$USER_SMB_CONF" "$BACKUP_FILE"
        echo "[FileHatch-Samba] Backed up old config to $BACKUP_FILE"
        echo "[FileHatch-Samba] Applying new template with trash integration..."
        cat /smb.conf.template > /etc/samba/smb.conf
    fi
elif [ -f "/smb.conf.template" ]; then
    echo "[FileHatch-Samba] Installing default smb.conf from template..."
    cat /smb.conf.template > /etc/samba/smb.conf
fi

# Create users group if not exists
groupadd -f users 2>/dev/null || true

# Ensure directories exist
mkdir -p /data/users /data/shared /var/log/samba

# /data/shared root: 755 (root:root) - users cannot create folders at root level
# Only admin-created shared drive folders are writable
chmod 755 /data/shared
chown root:root /data/shared 2>/dev/null || true

# Fix permissions on SUBDIRECTORIES only in /data/shared
# This ensures SMB users can write inside shared drive folders, but not at root
echo "[FileHatch-Samba] Fixing shared folder permissions..."
find /data/shared -mindepth 1 -type d -exec chmod 775 {} \; 2>/dev/null || true
find /data/shared -mindepth 1 -type d -exec chown :users {} \; 2>/dev/null || true
find /data/shared -mindepth 1 -type f -exec chmod 664 {} \; 2>/dev/null || true
find /data/shared -mindepth 1 -type f -exec chown :users {} \; 2>/dev/null || true

# Create audit log files
echo "[FileHatch-Samba] Setting up audit logging..."
touch "$AUDIT_LOG"
touch /var/log/samba/smb_audit.log
chmod 644 "$AUDIT_LOG"
chmod 644 /var/log/samba/smb_audit.log

# Start rsyslog daemon to capture vfs_full_audit logs
echo "[FileHatch-Samba] Starting rsyslog for audit capture..."
rsyslogd 2>/dev/null || true

# Start audit log watcher - monitors rsyslog output for SMB_AUDIT entries
# and writes them to the shared audit log file
(
    echo "[FileHatch-Samba] Starting audit log watcher..."
    sleep 2  # Wait for rsyslog to start
    tail -F /var/log/samba/smb_audit.log 2>/dev/null | while read -r line; do
        if [[ "$line" == *"SMB_AUDIT"* ]]; then
            echo "$line" >> "$AUDIT_LOG"
        fi
    done
) &

# Sync users from file
sync_users() {
    if [ -f "$SYNC_FILE" ]; then
        echo "[FileHatch-Samba] Syncing users from file..."

        while IFS=: read -r username password || [[ -n "$username" ]]; do
            # Skip empty lines and comments
            [[ -z "$username" || "$username" =~ ^# ]] && continue

            # Create Linux user if not exists (Alpine uses adduser)
            if ! id "$username" &>/dev/null; then
                adduser -D -H -G users -s /sbin/nologin "$username" 2>/dev/null || true
                echo "[FileHatch-Samba] Created Linux user: $username"
            fi

            # Create user home directory
            mkdir -p "/data/users/$username"
            chown "$username:users" "/data/users/$username" 2>/dev/null || true
            chmod 755 "/data/users/$username"

            # Set Samba password
            if [ -n "$password" ]; then
                # Use sed to get password and pass directly to smbpasswd
                # Duplicate line using sed and pipe directly to avoid bash variable expansion
                sed -n "s/^${username}://p" "$SYNC_FILE" | head -1 | sed 'p' | smbpasswd -a -s "$username"
                smbpasswd -e "$username" || true
                echo "[FileHatch-Samba] Updated Samba user: $username"
            fi
        done < "$SYNC_FILE"

        echo "[FileHatch-Samba] User sync completed."
    fi
}

# Start smbd and nmbd first (needed for TDB backend initialization)
echo "[FileHatch-Samba] Starting Samba services..."
nmbd -D 2>/dev/null || true
smbd -D 2>/dev/null || true

# Wait for Samba to initialize
sleep 2

# Initial sync (after Samba is running)
sync_users

# Real-time file watcher in background
(
    echo "[FileHatch-Samba] Starting real-time file watcher..."
    mkdir -p "$SYNC_DIR"

    while true; do
        # Watch for file changes (modify, create, move)
        inotifywait -q -e modify,create,moved_to "$SYNC_DIR" 2>/dev/null

        # Small delay to ensure file write is complete
        sleep 0.5

        if [ -f "$SYNC_FILE" ]; then
            echo "[FileHatch-Samba] Detected change in sync file, reloading users..."
            sync_users
        fi
    done
) &

echo "[FileHatch-Samba] User sync service started."

# Keep container running
wait
