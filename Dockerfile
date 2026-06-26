# Use a Debian-based Node image
FROM node:18-bullseye

# Install OpenJDK (Java Compiler/Runtime) and Python 3
RUN apt-get update && apt-get install -y \
    python3 \
    openjdk-17-jdk \
    openjdk-17-jre \
    && rm -rf /var/lib/apt/lists/*

# Set up the working directory
WORKDIR /app

# Copy package configuration and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application files
COPY . .

# Expose the server port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
