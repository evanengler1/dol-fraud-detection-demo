import { handle } from "@/lib/server/route"
import { PERSONA_MODE, queryAs, runtimeMode } from "@/lib/server/db"

export const dynamic = "force-dynamic"

/** Shows the session the persona actually runs as, plus a live masking sample. */
export async function GET(req: Request) {
  return handle(req, async (persona) => {
    const [who] = await queryAs(
      persona,
      `SELECT CURRENT_USER() AS USER_NAME, CURRENT_ROLE() AS ROLE_NAME, CURRENT_WAREHOUSE() AS WAREHOUSE, CURRENT_TIMESTAMP() AS AT`,
    )
    // In emulate mode the session role is the owner role; governance is applied by the app
    return { ...who, persona, mode: runtimeMode, personaMode: PERSONA_MODE }
  })
}
