# Use the official Node.js image as the base image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including dev dependencies for nodemon)
RUN npm ci

# Copy the application code into the container
COPY . .

# Create logs directory
RUN mkdir -p logs

# Expose the port that the application will run on
EXPOSE 3002

# Add a volume to the container for logs
VOLUME /app/logs

# Run the application
CMD ["npm", "start"] 