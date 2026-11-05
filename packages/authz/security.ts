import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  randomUUID,
  scrypt,
} from "node:crypto";
import type { Store, Row } from "../storage/database.ts";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export function assert(
  condition: unknown,
  status: number,
  message: string,
): asserts condition {
  if (!condition) throw new HttpError(status, message);
}
export function text(
  value: unknown,
  name: string,
  max = 6000,
  min = 1,
): string {
  assert(
    typeof value === "string" &&
      value.trim().length >= min &&
      value.length <= max,
    400,
    `${name} must contain ${min}–${max} characters.`,
  );
  return value.trim();
}
export function version(value: unknown): number {
  assert(
    typeof value === "number" && Number.isSafeInteger(value) && value > 0,
    400,
    "Provide the positive integer version you reviewed.",
  );
  return value;
}
export function choice(
  value: unknown,
  allowed: string[],
  name: string,
): string {
  assert(
    typeof value === "string" && allowed.includes(value),
    400,
    `Invalid ${name}.`,
  );
  return value;
}
export function email(value: unknown): string {
  const s = text(value, "Email", 254).toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), 400, "Enter a valid email.");
  return s;
}
export function url(value: unknown): string {
  const s = text(value, "URL", 2000, 0);
  if (!s) return "";
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new HttpError(400, "Enter a valid HTTPS URL.");
  }
  assert(
    u.protocol === "https:" && !u.username && !u.password,
    400,
    "Use an HTTPS URL without credentials.",
  );
  return u.href;
}
const SCRYPT = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
export function passwordValue(value: unknown, min = 1): string {
  assert(
    typeof value === "string" && value.length >= min && value.length <= 200,
    400,
    `Password must contain ${min}–200 characters.`,
  );
  return value;
}
export function hashPassword(value: string): string {
  passwordValue(value, 14);
  const salt = randomBytes(16).toString("hex");
  return `scrypt:65536:8:2:${salt}:${scryptSync(value, salt, 64, SCRYPT).toString("hex")}`;
}

export async function verifyPassword(
  value: string,
  hash: string,
): Promise<boolean> {
  const [algorithm, N, r, p, salt, encoded] = hash.split(":");
  if (
    algorithm !== "scrypt" ||
    N !== "65536" ||
    r !== "8" ||
    p !== "2" ||
    !salt ||
    !encoded ||
    !/^([a-f0-9]{128})$/.test(encoded)
  )
    return false;
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scrypt(value, salt, 64, SCRYPT, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
  return timingSafeEqual(actual, Buffer.from(encoded, "hex"));
}
export function account(
  s: Store,
  name: string,
  address: string,
  password: string,
  organization: string | null,
  role = "member",
) {
  const user = {
    id: id(),
    name: text(name, "Name", 100),
    email: email(address),
  };
  s.transaction(() => {
    s.run(
      "INSERT INTO users VALUES (?,?,?,?,?)",
      user.id,
      user.email,
      user.name,
      hashPassword(password),
      now(),
    );
    if (organization)
      s.run(
        "INSERT INTO organization_members VALUES (?,?,?)",
        organization,
        user.id,
        choice(role, ["founder", "member"], "organization role"),
      );
  });
  return user;
}
export function membership(
  s: Store,
  project: string,
  user: string,
  internal = false,
): Row {
  const m = s.get(
    `SELECT m.*,p.organization_id FROM memberships m JOIN projects p ON p.id=m.project_id
    WHERE m.project_id=? AND m.user_id=? AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at>?)`,
    project,
    user,
    now(),
  );
  assert(
    m && (!internal || m.role !== "client"),
    404,
    "Project not found or access is unavailable.",
  );
  return m;
}
export function owner(s: Store, project: string, user: string): Row {
  const m = membership(s, project, user, true);
  assert(m.role === "owner", 403, "Project owner permission required.");
  return m;
}
export function founder(s: Store, organization: string, user: string) {
  assert(
    s.get(
      "SELECT 1 FROM organization_members WHERE organization_id=? AND user_id=? AND role='founder'",
      organization,
      user,
    ),
    403,
    "Founder permission required.",
  );
}
export function rate(s: Store, key: string, max: number, windowMs: number) {
  const time = Date.now();
  const r = s.get(
    `INSERT INTO rate_limits(key,count,resets_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET
    count=CASE WHEN resets_at<=? THEN 1 ELSE count+1 END,
    resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END RETURNING count`,
    key,
    time + windowMs,
    time,
    time,
  );
  assert(
    r && r.count <= max,
    429,
    "Too many attempts. Please try again later.",
  );
}
