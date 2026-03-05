export type AuthRole = "user" | "admin";

export type AuthTokenPayload = {
  sub: string;
  email: string;
  name: string;
  role: AuthRole;
};

export type AuthSession = {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
};
