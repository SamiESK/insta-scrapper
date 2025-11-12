import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../.env') });

const prisma = new PrismaClient();

async function seed() {
  console.log('Seeding accounts...');

  // Example accounts (replace with your actual accounts)
  const accounts = [
    {
      username: 'example_account_1',
      proxy: null,
      status: 'idle'
    },
    {
      username: 'example_account_2',
      proxy: 'http://proxy1.com:8080',
      status: 'idle'
    }
  ];

  for (const accountData of accounts) {
    try {
      const account = await prisma.account.create({
        data: accountData
      });
      console.log(`Created account: ${account.username} (ID: ${account.id})`);
    } catch (error) {
      if (error.code === 'P2002') {
        console.log(`Account ${accountData.username} already exists, skipping...`);
      } else {
        console.error(`Error creating account ${accountData.username}:`, error);
      }
    }
  }

  console.log('Seeding complete!');
}

seed()
  .catch((error) => {
    console.error('Seeding error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

