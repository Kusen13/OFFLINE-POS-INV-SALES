# OFFLINE-FIRST POS, INVENTORY & SALES TRACKING SYSTEM

A local, offline-first Point of Sale system designed for small businesses. Mobile devices handle sales via a PWA, while a Windows laptop runs the main dashboard, database, and API. Synchronization happens manually over local Wi-Fi—no internet required.

## Quick Start

### Prerequisites
- **XAMPP** (Apache + MariaDB running)
- **Node.js** 18+ and npm
- **Git**

### 1. Database Setup
```bash
# Start XAMPP (Apache + MySQL)
# Then run the schema:
C:\xampp\mysql\bin\mysql.exe -u root < database/schema.sql
C:\xampp\mysql\bin\mysql.exe -u root < database/seed.sql
```

### 2. Verify API
Open: `http://127.0.0.1/OFFLINE-POS-INV-SALES/api/health`  
You should see: `{"success":true,"data":{"status":"ok",...}}`

### 3. Frontend Development
```bash
cd frontend
npm install
npm run dev
```
Open: `http://localhost:5173`

### 4. Build for Production
```bash
cd frontend
npm run build
```
The built files go to `frontend/dist/`. See [docs/SETUP.md](docs/SETUP.md) for deployment instructions.

## Architecture
- **Frontend**: React + TypeScript + Vite + Tailwind CSS (PWA)
- **Backend**: PHP REST API on Apache (XAMPP)
- **Database**: MariaDB (11 normalized tables)
- **Offline**: IndexedDB for sales queue + Service Worker for app cache
- **Sync**: Manual, over local Wi-Fi, no internet needed

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for details.

## Project Structure
```
├── api/                    # PHP REST API
│   ├── controllers/        # Route handlers
│   ├── config/             # DB & CORS config
│   ├── middleware/          # Validation
│   └── utils/              # Response helpers
├── database/
│   ├── schema.sql          # Full database schema
│   └── seed.sql            # Sample data
├── frontend/               # React + Vite PWA
│   └── src/
│       ├── api/            # HTTP client
│       ├── components/     # UI components
│       ├── db/             # IndexedDB layer
│       ├── features/       # Zustand stores
│       ├── hooks/          # Custom hooks
│       ├── pages/          # Route pages
│       ├── types/          # TypeScript types
│       └── utils/          # Utilities
└── docs/                   # Documentation
```

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/products` | List products |
| POST | `/api/products` | Create product |
| PUT | `/api/products/{id}` | Update product |
| GET | `/api/categories` | List categories |
| GET | `/api/sales` | Sales history |
| GET | `/api/inventory` | Stock levels |
| POST | `/api/inventory/movements` | Stock adjustment |
| POST | `/api/sync/sales` | Receive sales from mobile |
| GET | `/api/sync/products` | Send products to mobile |
| GET | `/api/reports/daily` | Daily sales report |
| GET | `/api/reports/summary` | Dashboard summary |
| GET | `/api/settings` | App settings |

## License
Private - Internal use only.
