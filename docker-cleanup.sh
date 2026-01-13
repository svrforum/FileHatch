#!/bin/bash
# Docker cleanup script - removes unused images, containers, and build cache

# Remove dangling images (untagged)
docker image prune -f

# Remove unused build cache
docker builder prune -f

# Remove stopped containers
docker container prune -f

# Log cleanup time
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Docker cleanup completed" >> /var/log/docker-cleanup.log
