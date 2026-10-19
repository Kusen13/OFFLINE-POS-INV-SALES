# Database Backup & Recovery

## Backup

### Quick Backup (Command Line)
```bash
C:\xampp\mysql\bin\mysqldump.exe -u root pos_system > backup_YYYYMMDD.sql
```

### Automated Backup Script
Save as `backup.bat` and schedule with Task Scheduler:
```batch
@echo off
set TIMESTAMP=%date:~-4,4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%
set BACKUP_DIR=C:\xampp\htdocs\OFFLINE-POS-INV-SALES\database\dumps
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
C:\xampp\mysql\bin\mysqldump.exe -u root pos_system > "%BACKUP_DIR%\backup_%TIMESTAMP%.sql"
echo Backup created: backup_%TIMESTAMP%.sql
```

### phpMyAdmin Backup
1. Open `http://127.0.0.1/phpmyadmin`
2. Select `pos_system` database
3. Click **Export** tab
4. Choose **Quick** or **Custom** export
5. Click **Go** to download the SQL file

## Recovery

### Restore from Backup
```bash
# Drop and recreate database
C:\xampp\mysql\bin\mysql.exe -u root -e "DROP DATABASE IF EXISTS pos_system;"

# Restore from backup
C:\xampp\mysql\bin\mysql.exe -u root < backup_YYYYMMDD.sql
```

### Reset to Clean State
```bash
C:\xampp\mysql\bin\mysql.exe -u root -e "DROP DATABASE IF EXISTS pos_system;"
C:\xampp\mysql\bin\mysql.exe -u root < database/schema.sql
C:\xampp\mysql\bin\mysql.exe -u root < database/seed.sql
```

## Best Practices

1. **Backup daily** before major operations
2. **Keep at least 7 days** of backups
3. **Store backups on a separate drive** or USB
4. **Test restores periodically** to verify backup integrity
5. The `database/dumps/` directory is git-ignored to prevent large files in version control
