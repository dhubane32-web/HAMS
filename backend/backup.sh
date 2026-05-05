#!/bin/bash

mkdir -p ./backups

cp -R ./var/backups ./backups/system-db-backup-$(date +%F-%H-%M)
cp ./src/config/db.js ./backups/db-config-backup-$(date +%F-%H-%M).js

echo "Backup completed successfully"
