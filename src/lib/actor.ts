/**
 * The auth seam. Today there is exactly one user. When real auth arrives,
 * this function reads the session and returns the signed-in user; nothing
 * else in the app needs to change.
 */
export type Actor = { id: string; name: string };

const LOCAL_USER: Actor = { id: "local-user", name: "You" };

export async function getActor(): Promise<Actor> {
  return LOCAL_USER;
}
