#!/usr/bin/env node

/**
 * User Registration Script
 * 
 * Creates a new user in the database with a hashed password.
 * 
 * Usage:
 *   npm run create-user
 *   or
 *   node scripts/create-user.js <email> <password> [name]
 * 
 * Interactive mode:
 *   node scripts/create-user.js
 */

import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import * as readline from 'readline';

const prisma = new PrismaClient();

interface UserInput {
  email: string;
  password: string;
  name?: string;
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptPassword(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function getUserInput(): Promise<UserInput> {
  const email = await prompt('Email: ');
  if (!email) {
    throw new Error('Email is required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }

  const password = await promptPassword('Password: ');
  if (!password) {
    throw new Error('Password is required');
  }

  if (password.length < 6) {
    throw new Error('Password must be at least 6 characters long');
  }

  const confirmPassword = await promptPassword('Confirm Password: ');
  if (password !== confirmPassword) {
    throw new Error('Passwords do not match');
  }

  const name = await prompt('Name (optional): ');

  return {
    email,
    password,
    name: name || undefined,
  };
}

async function createUser(input: UserInput) {
  try {
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existingUser) {
      throw new Error(`User with email ${input.email} already exists`);
    }

    // Hash password
    const hashedPassword = await hash(input.password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: hashedPassword,
        name: input.name,
        is_active: true,
      },
    });

    console.log('\n✅ User created successfully!');
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name || 'N/A'}`);
    console.log(`   Active: ${user.is_active}`);
    console.log(`   Created: ${user.created_at}`);
  } catch (error: any) {
    console.error('\n❌ Error creating user:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const args = process.argv.slice(2);

  let userInput: UserInput;

  if (args.length >= 2) {
    // Command line arguments provided
    const [email, password, name] = args;

    // Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      console.error('❌ Invalid email format');
      process.exit(1);
    }

    if (password.length < 6) {
      console.error('❌ Password must be at least 6 characters long');
      process.exit(1);
    }

    userInput = {
      email,
      password,
      name: name || undefined,
    };
  } else {
    // Interactive mode
    console.log('Create a new user account\n');
    try {
      userInput = await getUserInput();
    } catch (error: any) {
      console.error(`\n❌ ${error.message}`);
      process.exit(1);
    }
  }

  await createUser(userInput);
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
