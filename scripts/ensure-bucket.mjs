#!/usr/bin/env node
// Creates the storage bucket when it is missing. Safe to run repeatedly.
// Imports the built shared package by path so it resolves its own dependencies.
import { createStorageClient, ensureBucket, loadConfig } from "../packages/shared/dist/index.js";

const config = loadConfig();
const created = await ensureBucket(createStorageClient(config), config.S3_BUCKET);

console.log(`bucket "${config.S3_BUCKET}" ${created ? "created" : "already exists"}`);
