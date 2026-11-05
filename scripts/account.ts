import { Store } from "../packages/storage/database.ts";
import { account } from "../packages/authz/security.ts";
const [address, name, role = "member"] = process.argv.slice(2);
if (!address || !name || !process.env.MIZVO_ACCOUNT_PASSWORD) {
  console.error(
    'Usage: MIZVO_ACCOUNT_PASSWORD=<secret> npm run account -- email "Name" founder|member|client',
  );
  process.exit(1);
}
const s = new Store(process.env.MIZVO_DATABASE ?? "var/mizvo.sqlite");
const org = process.env.MIZVO_ORGANIZATION ?? "mizvo";
s.run("INSERT OR IGNORE INTO organizations VALUES (?,?)", org, "Mizvo");
try {
  const user = account(
    s,
    name,
    address,
    process.env.MIZVO_ACCOUNT_PASSWORD,
    role === "client" ? null : org,
    role,
  );
  console.log(JSON.stringify({ id: user.id, status: "created" }));
} finally {
  s.close();
}
