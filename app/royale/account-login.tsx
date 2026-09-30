"use client";

import { useState } from "react";
import { authClient } from "../../lib/auth-client";

export function AccountLogin({
  google,
  pending,
  active,
  act,
}: {
  google: boolean;
  pending: boolean;
  active: boolean;
  act: (work: () => Promise<unknown>) => Promise<void>;
}) {
  const [register, setRegister] = useState(false);
  const disabled = pending || active;
  return (
    <>
      {google ? (
        <button
          className="primary"
          disabled={disabled}
          onClick={() =>
            void act(async () => {
              const response = await authClient.signIn.social({
                provider: "google",
                callbackURL: `${location.origin}/account`,
              });
              if (response.error) throw new Error(response.error.message);
            })
          }
        >
          Continue with Google
        </button>
      ) : null}
      <h2>{register ? "Create an account" : "Log in with your password"}</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          const username = String(fields.get("username") || "").trim();
          const password = String(fields.get("password") || "");
          void act(async () => {
            const response = register
              ? await authClient.signUp.email({
                  username,
                  name: username,
                  email: String(fields.get("email") || "").trim(),
                  password,
                })
              : username.includes("@")
                ? await authClient.signIn.email({ email: username, password })
                : await authClient.signIn.username({ username, password });
            if (response.error) throw new Error(response.error.message);
            location.assign("/account");
          });
        }}
      >
        <fieldset disabled={disabled} className="login-fields">
          <label htmlFor="login-username">
            {register ? "Username" : "Username or email"}
          </label>
          <input
            key={register ? "register" : "login"}
            id="login-username"
            name="username"
            autoComplete="username"
            required
            minLength={register ? 3 : undefined}
            maxLength={register ? 24 : undefined}
            pattern={register ? "[A-Za-z0-9_]+" : undefined}
            aria-describedby={register ? "username-help" : undefined}
          />
          {register ? (
            <>
              <p id="username-help" className="fine-print">
                3–24 letters, numbers, or underscores. Usernames are not
                case-sensitive.
              </p>
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                required
              />
            </>
          ) : null}
          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={register ? 8 : undefined}
            maxLength={128}
            aria-describedby={register ? "password-help" : undefined}
          />
          {register ? (
            <p id="password-help" className="fine-print">
              Use at least 8 characters.
            </p>
          ) : null}
          <button className="primary" type="submit">
            {pending ? "Please wait…" : register ? "Create account" : "Log in"}
          </button>
        </fieldset>
      </form>
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => setRegister(!register)}
      >
        {register
          ? "Already have an account? Log in"
          : "New here? Create an account"}
      </button>
      <p className="fine-print">
        By creating an account or playing, you agree to our{" "}
        <a href="/terms">Terms of Service</a>. Read our{" "}
        <a href="/privacy">Privacy Policy</a> for how we use your information.
      </p>
    </>
  );
}
