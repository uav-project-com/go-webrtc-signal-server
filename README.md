
# Go REST API with PostgreSQL

This is a sample Go REST API project that demonstrates how to perform CRUD operations on a `Product` resource using the Gin framework and PostgreSQL. The project also includes middleware for logging the IP address of incoming requests.

## Project Structure

```
go-rest-api
│   main.go
├───config
│       config.go
├───controllers
│       product_controller.go
├───middleware
│       ip_logger.go
├───models
│       product.go
│       database.go
├───routes
│       routes.go
└───utils
        response.go
```

## Features

- Create, read, update, and delete products
- Log IP addresses of incoming requests

## Getting Started

### Prerequisites

- Go 1.20 or higher
- PostgreSQL
- Git
- Docker (optional, for running PostgreSQL in a container)

### Installation

1. Clone the repository:

   ```sh
   git clone https://github.com/hasithaishere/go-rest-api-with-postgresql.git
   cd go-rest-api
   ```

2. Install dependencies:

   ```sh
   go mod tidy
   ```

3. Set up PostgreSQL:

   - **Option 1: Using Docker (Recommended)**
     - Run PostgreSQL in a Docker container:

       ```sh
       docker run -d --name postgres-db -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=password -e POSTGRES_DB=h_engine -p 5432:5432 -d postgres
       ```
     - for WSL connect to localhost:5432 in Windows:
        - add inbound rule in Windows Defender Firewall to allow port 5432
        - Run command for know ip windows to connect: `ip route show | grep default`
        - Connect it, for example: `default via 172.29.96.1 dev eth0 proto kernel` => `172.29.96.1:5432`
        - When error, update permission:
```bash
# show config file
SHOW config_file
# "D:/database/postgres17/postgresql.conf"
# Thêm dòng sau:
host    all             all             172.29.0.0/16           scram-sha-256
# Restart postgres
# test again:
psql -h 172.29.96.1 -U postgres -d postgres

```

     - Update the `.env` file with your PostgreSQL credentials:

       ```env
       DB_USER=your_db_user
       DB_PASSWORD=your_db_password
       DB_NAME=your_db_name
       DB_HOST=localhost
       DB_PORT=5432
       ```

   - **Option 2: Local PostgreSQL Installation**
     - Create a new PostgreSQL database.
     - Update the `.env` file with your PostgreSQL credentials:

       ```env
       DB_USER=your_db_user
       DB_PASSWORD=your_db_password
       DB_NAME=your_db_name
       DB_HOST=your_db_host
       DB_PORT=your_db_port
       ```

4. Create the `products` table in your PostgreSQL database:

   ```sql
   CREATE TABLE products (
       id SERIAL PRIMARY KEY,
       name VARCHAR(255) NOT NULL,
       price INTEGER NOT NULL,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
       updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
   );
   ```

### Running the Application

1. Start the application:

   ```sh
   go run main.go
   ```

2. The server will start on `http://localhost:8080`.

### API Endpoints

- **GET /products**: Retrieve all products
- **POST /products**: Create a new product
  - Request body: `{ "name": "Sample Product", "price": 100 }`
- **GET /products/:id**: Retrieve a product by ID
- **PUT /products/:id**: Update a product by ID
  - Request body: `{ "name": "Updated Product", "price": 150 }`
- **DELETE /products/:id**: Delete a product by ID

### Example CURL Commands

- **Create a product:**

  ```sh
  curl -X POST http://localhost:8080/products \
       -H "Content-Type: application/json" \
       -d '{
             "name": "Sample Product",
             "price": 100
           }'
  ```

- **Get all products:**

  ```sh
  curl http://localhost:8080/products
  ```

- **Get a product by ID:**

  ```sh
  curl http://localhost:8080/products/1
  ```

- **Update a product by ID:**

  ```sh
  curl -X PUT http://localhost:8080/products/1 \
       -H "Content-Type: application/json" \
       -d '{
             "name": "Updated Product",
             "price": 150
           }'
  ```

- **Delete a product by ID:**

  ```sh
  curl -X DELETE http://localhost:8080/products/1
  ```

### Middleware

The project includes a middleware that logs the IP address of incoming requests. The middleware is defined in `middleware/ip_logger.go` and is registered in the router setup in `routes/routes.go`.

### License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
