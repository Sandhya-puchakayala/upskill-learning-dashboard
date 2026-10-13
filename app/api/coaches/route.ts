import { handle } from "@/lib/api";
import { listCoaches } from "@/lib/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return handle(async () => ({ coaches: await listCoaches() }));
}
