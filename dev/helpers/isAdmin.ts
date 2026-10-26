import type { Access } from 'payload'

/** Application-owned policy, reused by the plugin and its tests. */
export const isAdmin: Access = ({ req }) =>
  req.user?.collection === 'users' && req.user.role === 'admin'
