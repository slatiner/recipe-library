// The storage adapter. All reads and writes go through one of these, so the
// backend can change without touching the views.
//
// An adapter is created with setStatus(state, text, account, profile), which it
// calls to report the connection: state is 'checking' | 'signedOut' |
// 'needsInvite' | 'ok' | 'warn'; account is the signed-in email, if any;
// profile is { name, avatarUrl, isAdmin } from the sign-in provider and the
// account's membership, or null.
// It provides:
//   init()                  restore a previous session; recipes[] or null
//   connect()               user action to sign in; null (the page leaves)
//   reconnect()             retry after an error; recipes[] or null
//   signOut()
//   redeemInvite(code)      join with an invite code; recipes[] or null
//   requestAccess(message)  signed in, not a member: ask for a code
//   createInvite()          (admins) { code, expiresAt }
//   listInvites()           (admins) recent invites
//   listAccessRequests()    (admins) [{ userId, email, name, message, createdAt }]
//   dismissAccessRequest(u) (admins)
//   exportAccount()         everything stored for the account, one object
//   deleteAccount()         delete the account and its data, then sign out
//   llmEndpoint()           { url, headers } of the Groq proxy for the
//                           signed-in user, or null
export { createSupabaseStorage } from './supabaseStorage.js';
