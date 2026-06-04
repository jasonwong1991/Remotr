# Remotr Docker Deployment Guide

## Quick Start

### 1. Build and Run with Docker Compose
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

### 2. Access Remotr

- **Debugger Panel**: http://localhost:9777
- **Inject Script**: http://localhost:9777/remotr.js

### 3. Inject into Target Page

```html
<script src="http://localhost:9777/remotr.js" data-room="default"></script>
```

Or manually:

```javascript
const script = document.createElement('script');
script.src = 'http://localhost:9777/remotr.js';
script.setAttribute('data-room', 'default');
document.body.appendChild(script);
```

---

## Production Deployment

### Remote Server Deployment

1. **Update docker-compose.yml** to bind to all interfaces:

```yaml
ports:
  - "0.0.0.0:9777:9777"
```

2. **With Domain Name** (recommended with nginx-proxy):

```yaml
version: '3.8'

services:
  nginx-proxy:
    image: nginxproxy/nginx-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/tmp/docker.sock:ro
      - nginx-certs:/etc/nginx/certs
      - nginx-vhost:/etc/nginx/vhost.d
    - nginx-html:/usr/share/nginx/html
    restart: unless-stopped

  remotr:
    build: .
    environment:
      - VIRTUAL_HOST=remotr.yourdomain.com
      - VIRTUAL_PORT=9777
    restart: unless-stopped

volumes:
  nginx-certs:
  nginx-vhost:
  nginx-html:
```

3. **Inject Script**:

```html
<script src="https://remotr.yourdomain.com/remotr.js" data-room="production"></script>
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `9777` | Server port |
| `NODE_ENV` | `production` | Node environment |
| `DEFAULT_ROOM` | `default` | Default room name |

### Custom Port

```yaml
services:
  remotr:
    environment:
      - PORT=8080
    ports:
      - "8080:8080"
```

---

## Management

### Useful Commands

```bash
# Build image
docker-compose build

# Start in detached mode
docker-compose up -d

# View logs
docker-compose logs -f remotr

# Restart
docker-compose restart

# Stop and remove containers
docker-compose down

# Stop and remove with volumes
docker-compose down -v

# Check status
docker-compose ps

# Execute command in container
docker-compose exec remotr sh
```

### Update to Latest Version

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose up -d --build
```

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose logs remotr

# Check if port is in use
lsof -i :9777

# Restart container
docker-compose restart remotr
```

### WebSocket Connection Failed

1. Ensure port 9777 is accessible
2. Check firewall rules
3. Verify nginx proxy configuration if using reverse proxy

### Build Failures

```bash
# Clean build
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

---

## Security Recommendations

1. **Use HTTPS in production**
2. **Configure firewall** to restrict access
3. **Use environment variables** for sensitive config
4. **Regular updates**: `docker-compose pull && docker-compose up -d`

---

## Performance Tuning

### Resource Limits

```yaml
services:
  remotr:
    deploy:
      resources:
        limits:
          cpus: '1.0'
       memory: 512M
        reservations:
       cpus: '0.5'
          memory: 256M
```

---

For more information, see the main [README.md](./README.md)
