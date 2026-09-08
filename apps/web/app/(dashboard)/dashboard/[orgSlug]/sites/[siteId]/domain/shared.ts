// Separate from actions.ts because a "use server" file may only export async
// functions — plain constants/types have to live outside it.
export const VERIFICATION_PREFIX = "_voiddocs-challenge";

export interface DomainActionState {
  error?: string;
}
