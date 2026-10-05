import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },

  pages: {
    signIn: "/login",
    error: "/login",
  },

  trustHost: true,

  providers: [
    CredentialsProvider({
      name: "Credentials",

      credentials: {
        email: {
          label: "Email",
          type: "email",
        },

        password: {
          label: "Password",
          type: "password",
        },
      },

      async authorize(credentials) {
        try {
          if (!credentials?.email || !credentials?.password) {
            throw new Error("Email and password are required.");
          }

          const user = await prisma.user.findUnique({
            where: {
              email: credentials.email.toLowerCase().trim(),
            },
          });

          if (!user) {
            throw new Error("Invalid email or password.");
          }

          const validPassword = await bcrypt.compare(
            credentials.password,
            user.password
          );

          if (!validPassword) {
            throw new Error("Invalid email or password.");
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
            role: user.role,
            mustResetPassword: user.mustResetPassword,
          };
        } catch (error) {
          console.error("AUTH ERROR:", error);
          return null;
        }
      },
    }),
  ],

  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;
        token.mustResetPassword = (user as any).mustResetPassword;
      }

      // Re-read the flag when the client calls update() so the forced-reset
      // prompt clears without a full re-login.
      if (trigger === "update" && token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { mustResetPassword: true },
        });
        if (dbUser) token.mustResetPassword = dbUser.mustResetPassword;
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
        (session.user as any).mustResetPassword = token.mustResetPassword;
      }

      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};