#!/bin/bash

# WhatsApp Template Bot Startup Script
# Usage: ./start.sh [dev|prod|docker]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env file exists
check_env() {
    if [ ! -f .env ]; then
        print_warning ".env file not found. Creating from template..."
        if [ -f env.example ]; then
            cp env.example .env
            print_warning "Please edit .env file with your Meta credentials before starting"
            exit 1
        else
            print_error "env.example not found. Please create .env file manually"
            exit 1
        fi
    fi
}

# Start development mode
start_dev() {
    print_status "Starting WhatsApp Template Bot in development mode..."
    check_env
    
    if [ ! -d "node_modules" ]; then
        print_status "Installing dependencies..."
        npm install
    fi
    
    print_status "Starting development server..."
    npm run dev
}

# Start production mode
start_prod() {
    print_status "Starting WhatsApp Template Bot in production mode..."
    check_env
    
    if [ ! -d "node_modules" ]; then
        print_status "Installing dependencies..."
        npm ci --only=production
    fi
    
    print_status "Starting production server..."
    npm start
}

# Start with Docker
start_docker() {
    print_status "Starting WhatsApp Template Bot with Docker..."
    check_env
    
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        print_error "Docker Compose is not installed. Please install Docker Compose first."
        exit 1
    fi
    
    print_status "Building and starting containers..."
    docker-compose up -d --build
    
    print_status "Waiting for services to start..."
    sleep 10
    
    # Check health
    if curl -s http://localhost:3000/health > /dev/null; then
        print_success "WhatsApp Template Bot is running!"
        print_status "Health check: http://localhost:3000/health"
        print_status "API docs: http://localhost:3000/"
    else
        print_error "Service health check failed"
        print_status "Check logs with: docker-compose logs -f whatsapp-template-bot"
        exit 1
    fi
}

# Stop Docker services
stop_docker() {
    print_status "Stopping WhatsApp Template Bot Docker services..."
    docker-compose down
    print_success "Services stopped"
}

# Show logs
show_logs() {
    print_status "Showing WhatsApp Template Bot logs..."
    docker-compose logs -f whatsapp-template-bot
}

# Show status
show_status() {
    print_status "WhatsApp Template Bot status:"
    docker-compose ps
    
    echo ""
    print_status "Container logs (last 20 lines):"
    docker-compose logs --tail=20 whatsapp-template-bot
}

# Main script logic
case "${1:-dev}" in
    "dev")
        start_dev
        ;;
    "prod")
        start_prod
        ;;
    "docker")
        start_docker
        ;;
    "stop")
        stop_docker
        ;;
    "logs")
        show_logs
        ;;
    "status")
        show_status
        ;;
    "help"|"-h"|"--help")
        echo "WhatsApp Template Bot Startup Script"
        echo ""
        echo "Usage: $0 [COMMAND]"
        echo ""
        echo "Commands:"
        echo "  dev     Start in development mode (default)"
        echo "  prod    Start in production mode"
        echo "  docker  Start with Docker Compose"
        echo "  stop    Stop Docker services"
        echo "  logs    Show Docker logs"
        echo "  status  Show service status"
        echo "  help    Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0              # Start in dev mode"
        echo "  $0 docker       # Start with Docker"
        echo "  $0 stop         # Stop Docker services"
        ;;
    *)
        print_error "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac 