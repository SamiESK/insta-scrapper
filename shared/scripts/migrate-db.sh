#!/bin/bash

# Database migration script
echo "Running database migrations..."

docker exec -it instagram-backend npx prisma migrate dev

echo "Migrations complete!"

