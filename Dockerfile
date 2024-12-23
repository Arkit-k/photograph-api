# Step 1: Use an official Node.js image as the base image
FROM node:18-alpine

# Step 2: Set the working directory inside the container
WORKDIR /app

# Step 3: Copy package.json and package-lock.json to the container
COPY package*.json ./

# Step 4: Install dependencies inside the container
RUN npm install

# Step 5: Copy the rest of the application code to the container
COPY . .

# Step 6: Build Prisma client (ensure it is generated on container build)
RUN npx prisma generate

# Step 7: Expose the port the app will run on
EXPOSE 8000

# Step 8: Start the application
CMD ["npm", "start"]
