# WhatsApp Template Bot

A modern, Docker-ready WhatsApp bot for creating and managing message templates using Meta Business API.

## 🚀 Features

- **Template Management**: Create, read, delete WhatsApp message templates
- **Message Sending**: Send template messages to WhatsApp users
- **Webhook Support**: Handle incoming WhatsApp messages
- **Docker Ready**: Full containerization with Docker and Docker Compose
- **Modern Stack**: Built with Node.js 18+, ES modules, and Express
- **Production Ready**: Includes logging, health checks, and error handling
- **Redis Integration**: Scalable conversation storage

## 🏗️ Architecture

```
whatsapp-template-bot/
├── src/
│   ├── main.js              # Main application server
│   ├── template_utils.js    # Template management functions
│   └── logger_utils.js      # Winston logging configuration
├── logs/                    # Application logs
├── Dockerfile               # Multi-stage Docker build
├── docker-compose.yml       # Docker Compose configuration
├── package.json             # Node.js dependencies
└── env.example              # Environment configuration
```

## 📋 Prerequisites

- **Node.js 18+** or **Docker**
- **Meta Developer Account** with WhatsApp Business API access
- **Redis** (included in Docker setup)

## 🚀 Quick Start

### Option 1: Docker (Recommended)

1. **Clone and setup:**
   ```bash
   cd whatsapp-template-bot
   cp env.example .env
   # Edit .env with your Meta credentials
   ```

2. **Start with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

3. **Check status:**
   ```bash
   docker-compose ps
   curl http://localhost:3000/health
   ```

### Option 2: Local Development

1. **Install dependencies:**
   ```bash
   cd whatsapp-template-bot
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp env.example .env
   # Edit .env with your Meta credentials
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## 🔧 Configuration

### Environment Variables

Copy `env.example` to `.env` and configure:

```bash
# Meta WhatsApp Business API
META_ACCESS_TOKEN=your_meta_access_token
WHATSAPP_BUSINESS_ACCOUNT_ID=your_waba_id
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token

# Server
PORT=3000
NODE_ENV=development
BASE_URL=https://your-domain.com

# Redis
REDIS_URL=redis://localhost:6379
```

### Meta Developer Setup

1. Create app at [developers.facebook.com](https://developers.facebook.com)
2. Add WhatsApp product
3. Configure webhook: `https://your-domain.com/webhook`
4. Set verify token in `.env`
5. Subscribe to webhook fields: `messages`, `message_deliveries`, `message_reads`

## 📱 API Endpoints

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API documentation |
| `GET` | `/health` | Health check |
| `GET` | `/webhook` | Webhook verification |
| `POST` | `/webhook` | Receive WhatsApp messages |

### Template Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/create-template` | Create new template |
| `GET` | `/templates` | List all templates |
| `DELETE` | `/templates/:id` | Delete template |
| `POST` | `/send-template` | Send template message |

## 🎯 Usage Examples

### Create Template

```bash
curl -X POST "http://localhost:3000/create-template" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "welcome_message",
    "language": "en_US",
    "category": "UTILITY",
    "components": [
      {
        "type": "HEADER",
        "format": "TEXT",
        "text": "Welcome!"
      },
      {
        "type": "BODY",
        "text": "Hi {{1}}, welcome to our service!"
      }
    ]
  }'
```

### Send Template Message

```bash
curl -X POST "http://localhost:3000/send-template" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "RECIPIENT_PHONE_NUMBER",
    "templateName": "welcome_message",
    "components": [
      {
        "type": "body",
        "parameters": [
          {
            "type": "text",
            "text": "John"
          }
        ]
      }
    ]
  }'
```

## 🐳 Docker Commands

### Build and Run

```bash
# Build image
docker build -t whatsapp-template-bot .

# Run container
docker run -p 3000:3000 --env-file .env whatsapp-template-bot

# Run with Docker Compose
docker-compose up -d
```

### Management

```bash
# View logs
docker-compose logs -f whatsapp-template-bot

# Stop services
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

## 📊 Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

### Logs

```bash
# Application logs
tail -f logs/app-$(date +%Y-%m-%d).log

# Error logs
tail -f logs/error-$(date +%Y-%m-%d).log

# Docker logs
docker-compose logs -f whatsapp-template-bot
```

## 🔒 Security

- **Environment Variables**: Never commit `.env` files
- **HTTPS**: Use HTTPS in production
- **Rate Limiting**: Built-in rate limiting
- **Input Validation**: Request validation on all endpoints
- **Non-root User**: Docker runs as non-root user

## 🚀 Production Deployment

### 1. Environment Setup

```bash
NODE_ENV=production
BASE_URL=https://your-domain.com
# Configure production Redis and Meta credentials
```

### 2. Docker Production

```bash
# Build production image
docker build -t whatsapp-template-bot:prod .

# Run with production config
docker run -d \
  --name whatsapp-template-bot \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  whatsapp-template-bot:prod
```

### 3. Reverse Proxy (Optional)

The Docker Compose includes nginx configuration for SSL termination and load balancing.

## 🧪 Testing

### Manual Testing

1. **Start the bot:**
   ```bash
   npm run dev
   ```

2. **Test endpoints:**
   ```bash
   curl http://localhost:3000/health
   curl http://localhost:3000/templates
   ```

3. **Test webhook:**
   - Use ngrok for local testing
   - Configure Meta webhook URL
   - Send test message to your WhatsApp number

### Integration Testing

```bash
# Test template creation
npm test

# Test with sample data
node src/test-templates.js
```

## 📚 Documentation

- [Meta WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [WhatsApp Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Docker Documentation](https://docs.docker.com/)

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Add tests
5. Submit pull request

## 📄 License

MIT License - see LICENSE file for details

## 🆘 Support

For issues:
- Check logs in `logs/` directory
- Verify environment variables
- Test Meta API credentials
- Check Docker container status

## 🔄 Updates

To update the bot:

```bash
# Pull latest changes
git pull origin main

# Rebuild Docker image
docker-compose up -d --build

# Check status
docker-compose ps
curl http://localhost:3000/health
``` 