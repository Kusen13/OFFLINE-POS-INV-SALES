# Local Network Setup

## How It Works

The POS system runs on a local Wi-Fi network:
- **Laptop**: Runs XAMPP (Apache + MariaDB) as the server
- **Mobile devices**: Access the PWA via the laptop's local IP address
- **No internet required** for core operations

## Setup Steps

### 1. Find the Laptop's IP Address

Open PowerShell and run:
```powershell
ipconfig | Select-String "IPv4"
```

Look for an address like `192.168.x.x` or `10.x.x.x`.

### 2. Allow Apache Through Windows Firewall

Open PowerShell **as Administrator**:
```powershell
# Allow Apache HTTP (port 80)
New-NetFirewallRule -DisplayName "Apache HTTP" -Direction Inbound -Protocol TCP -LocalPort 80 -Action Allow

# Allow Vite dev server (port 5173) - for development only
New-NetFirewallRule -DisplayName "Vite Dev Server" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

Or manually through Windows Firewall settings:
1. Open **Windows Defender Firewall**
2. Click **Advanced Settings**
3. **Inbound Rules** → **New Rule**
4. Port → TCP → 80 → Allow → Name: "Apache HTTP"

### 3. Connect Mobile Device

1. Connect the mobile device to the **same Wi-Fi/hotspot** as the laptop
2. Open a browser on the mobile device
3. Navigate to: `http://LAPTOP_IP:5173` (development) or `http://LAPTOP_IP/OFFLINE-POS-INV-SALES/` (production)
4. Install the PWA when prompted (Add to Home Screen)

### 4. Test the Connection

From the mobile device, visit:
```
http://LAPTOP_IP/OFFLINE-POS-INV-SALES/api/health
```

You should see a JSON response confirming the server is reachable.

## Using a Mobile Hotspot

If no Wi-Fi router is available:
1. Enable **Mobile Hotspot** on any phone
2. Connect the laptop to this hotspot
3. Connect other devices to the same hotspot
4. Find the laptop's IP and proceed as above

## Security Notes

- The API restricts access to **private network ranges only** (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
- Public IP addresses are blocked by the `enforceLocalNetwork()` middleware
- Database credentials are stored server-side only (never in frontend code)
- No data is transmitted over the public internet

## iOS/Safari Notes

- Safari requires the PWA to be accessed via the **Add to Home Screen** action
- Service Worker support in Safari has some limitations but IndexedDB works fully
- On iOS, persistent storage may require the user to keep the PWA installed
- HTTPS is not required for `localhost` or local IPs on iOS 15+, but some features may be limited

## Troubleshooting

### Mobile can't reach the server
1. Verify both devices are on the **same network** (`192.168.x.x` should match)
2. Check Windows Firewall allows port 80 inbound
3. Test: `ping LAPTOP_IP` from mobile browser's address bar
4. Ensure Apache is running in XAMPP Control Panel

### PWA doesn't install
- The PWA requires serving over HTTPS or from `localhost`
- For local network access, Chrome on Android usually allows PWA install over HTTP on private IPs
- Safari on iOS requires "Add to Home Screen" from the share menu
