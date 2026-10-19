# Setup Guide

## Prerequisites

1. **XAMPP** installed at `C:\xampp` with Apache and MySQL running
2. **Node.js** 18+ and npm
3. **Git**

## Initial Setup

### 1. Clone / Place the Project
The project should be at: `C:\xampp\htdocs\OFFLINE-POS-INV-SALES\`

### 2. Create the Database

Open a terminal and run:
```bash
C:\xampp\mysql\bin\mysql.exe -u root < C:\xampp\htdocs\OFFLINE-POS-INV-SALES\database\schema.sql
C:\xampp\mysql\bin\mysql.exe -u root < C:\xampp\htdocs\OFFLINE-POS-INV-SALES\database\seed.sql
```

Or use phpMyAdmin:
1. Open `http://127.0.0.1/phpmyadmin`
2. Import `database/schema.sql`
3. Import `database/seed.sql`

### 3. Verify the API

Visit: `http://127.0.0.1/OFFLINE-POS-INV-SALES/api/health`

Expected response:
```json
{"success": true, "data": {"status": "ok", ...}}
```

### 4. Install Frontend Dependencies

```bash
cd C:\xampp\htdocs\OFFLINE-POS-INV-SALES\frontend
npm install
```

### 5. Start Development Server

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

## Important Notes

### Apache VirtualHost Configuration

If you have other projects using VirtualHosts in `httpd-vhosts.conf`, ensure requests to `127.0.0.1` reach the standard `htdocs` directory. The project API is accessed via:

```
http://127.0.0.1/OFFLINE-POS-INV-SALES/api/
```

During development, the Vite dev server proxies `/api` requests to Apache at `127.0.0.1:80`.

### Database Credentials

Default XAMPP credentials (in `api/config/database.php`):
- Host: `localhost`
- User: `root`
- Password: (empty)
- Database: `pos_system`

**Never expose these in frontend code.** The config file is server-side only.

### Building for Production

```bash
cd frontend
npm run build
```

This generates optimized files in `frontend/dist/` with:
- Service Worker for offline caching
- Precached app shell (14 entries)
- Code-split vendor, charts, and state chunks

## Troubleshooting

### API returns HTML instead of JSON
Your Apache VirtualHost for `localhost` may be routing to another project. Use `127.0.0.1` instead of `localhost` to hit the default `htdocs` DocumentRoot.

### Multi-segment API routes return 404
The `.htaccess` file uses RewriteRules to split URL segments into query parameters. Ensure `mod_rewrite` is enabled in Apache:
```
LoadModule rewrite_module modules/mod_rewrite.so
```

### Database connection fails
1. Ensure MySQL is running in XAMPP Control Panel
2. Check `api/config/database.php` for correct credentials
3. Verify database exists: `SHOW DATABASES LIKE 'pos_system';`
