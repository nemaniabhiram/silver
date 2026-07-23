import { customAlphabet } from "nanoid";

const DEPLOYMENT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const DEPLOYMENT_ID_LENGTH = 10;

const generate = customAlphabet(DEPLOYMENT_ID_ALPHABET, DEPLOYMENT_ID_LENGTH);

export const DEPLOYMENT_ID_PATTERN = /^[a-z0-9]{10}$/;

export function newDeploymentId(): string {
  return generate();
}

export function isDeploymentId(value: string): boolean {
  return DEPLOYMENT_ID_PATTERN.test(value);
}
