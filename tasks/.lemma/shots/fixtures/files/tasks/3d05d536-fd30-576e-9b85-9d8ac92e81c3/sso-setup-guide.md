# Turning on single sign-on

A one-page guide for the admin who rolls SSO out to their team. It covers SAML 2.0, which Okta, Google Workspace and Microsoft Entra ID all support. If your app only supports OIDC instead, everything before the provider-specific steps still applies; the fields you copy are just named differently.

## Before you start

- **An admin who can create apps in your identity provider.** Okta: super admin, or an admin with app-management rights. Google Workspace: a **super administrator** — nobody else can create a custom SAML app. Microsoft Entra ID: Cloud Application Administrator, Application Administrator, or owner of the app registration.
- **Users' sign-in emails must match the addresses your app knows them by.** SSO matches people on that address, so a mismatch quietly creates a second, empty account.
- **Your app's SAML values**, from its SSO settings page: **ACS URL** (where the identity provider posts the sign-in response), **Entity ID / Audience** (the app's unique name), and usually a metadata URL or XML file. Keep that tab open while you configure.
- **A test group with one or two real users** — not just you. Admins often keep a password fallback that hides breakage.
- **Don't enforce SSO for everyone in the same sitting** you first configure it.

## Okta

1. Admin Console → **Applications → Applications → Create App Integration**.
2. Sign-in method **SAML 2.0** → **Next**.
3. Name the app → **Next**.
4. Paste the **ACS URL** (Single sign-on URL) and **Entity ID** (Audience URI); tick *Use this for Recipient URL and Destination URL*. Set **Name ID format** to `EmailAddress` and Name ID to `user.email`, unless your app says otherwise → **Next**.
5. Choose *I'm an Okta customer adding an internal app* → **Finish**.
6. **Assignments** tab → assign the test group.
7. **Sign On** tab → copy the **Metadata URL** (or download the metadata XML) and the **SAML signing certificate** into the app's SSO settings.

## Google Workspace

1. Admin console → **Apps → Web and mobile apps → Add app → Add custom SAML app**.
2. Name it → **Continue**.
3. **Google Identity Provider details**: download the **IdP metadata**, or copy the **SSO URL** and **Entity ID** and download the **Certificate**. Enter these in your app.
4. **Service provider details**: paste the app's **ACS URL** and **Entity ID** (and Start URL if offered). Leave **Signed response** off unless the app requires it. Name ID format `EMAIL`, Name ID = primary email → **Continue**.
5. **Attribute mapping**: Primary email → the app's email attribute (often `email` or `mail`), First name → `firstName`, Last name → `lastName` → **Finish**.
6. Open the app → **User access** → **On** for the test organisational unit first, then **On for everyone** → **Save**. Changes can take up to 24 hours, usually far less.

## Microsoft Entra ID

1. **entra.microsoft.com** → **Entra ID → Enterprise apps → All applications** → your app (from the gallery, or **New application → Create your own application**). SAML SSO can only be configured on single-tenant or gallery apps — multi-tenant app registrations show it greyed out.
2. **Single sign-on → SAML**.
3. **Basic SAML Configuration → Edit**: **Identifier (Entity ID)** = your app's Entity ID, **Reply URL (Assertion Consumer Service URL)** = your app's ACS URL, **Sign on URL** = your app's sign-in page → **Save**.
4. **SAML Certificates** → download **Certificate (Base64)**; in **Set up <app>**, copy **Login URL** and **Microsoft Entra Identifier**. Enter all three in your app.
5. **Users and groups → Add user/group** → assign the test group.
6. **Single sign-on → Test** with an assigned user.

## After you turn it on — check these

- **Both directions work.** IdP-initiated: launch the app from the Okta / Google / Entra dashboard. SP-initiated: start at your app's sign-in page, get redirected, and land signed in. Repeat in a private window with no existing session.
- **It's the right account.** The test user sees their own data, not an empty workspace. If it's empty, the NameID / email doesn't match.
- **Attributes are right** — name and email arrive correctly, no duplicate users.
- **A non-admin can get in**, on desktop and in the mobile app.
- **You still have a way in.** Keep one break-glass admin with password + MFA before you enforce SSO for everyone.
- **Certificate expiry.** Note the end date and set a reminder 60 days ahead: an expired certificate locks everyone out at once.
- **Sign-out behaves as you expect.** SAML single logout is optional and often unsupported; people may stay signed in to the app after leaving the identity provider.
- **You know the rollback.** Google: User access → Off. Okta: unassign the group. Entra: set the SSO mode to Disabled. Switch it off — don't delete the app — if the pilot goes wrong.

## When it doesn't work

| What you see | What it usually is |
| --- | --- |
| Invalid signature / invalid SAML response | Wrong certificate, or the app wants the whole response signed while only the assertion is (tick **Signed response** in Google, **Sign SAML response** in Okta). |
| "User not assigned" | The person isn't in the group assigned to the app. |
| Sign-in loop, or a second blank account | NameID / email mismatch. |
| Works for you, not for others | You have an admin bypass. Test with a normal user. |
| "Assertion expired" | Server clock drift — check NTP on the app's side. |

---

Sources: Google Workspace Help, *Set up your own custom SAML app* (support.google.com/a/answer/6087519); Okta Help, *Create SAML app integrations* (help.okta.com); Microsoft Learn, *Enable SAML single sign-on for an enterprise application* (learn.microsoft.com/entra/identity/enterprise-apps/add-application-portal-setup-sso).
