**To:** it-admin@brightwave-health.example  
**Subject:** Turning on SSO for Brightwave with Microsoft Entra ID

Hi there,

Sam from Lemma. You would like single sign-on on before our renewal call on 2 December, so here is the whole job in plain words — about 15 minutes in the Entra admin centre.

1. Go to **entra.microsoft.com** and sign in as Global Administrator, Cloud Application Administrator or Application Administrator.
2. **Entra ID → Enterprise applications → All applications → New application → Create your own application.** Name it "Lemma", choose *Integrate any other application you do not find in the gallery (Non-gallery)*, then **Create**.
3. In the new app: **Single sign-on → SAML**.
4. **Basic SAML Configuration → Edit** and paste the three values from our SSO settings — the **Identifier (Entity ID)**, the **Reply URL (Assertion Consumer Service URL)** and the **Sign on URL** — then **Save**.
5. **SAML Certificates** → download **Certificate (Base64)**.
6. Send me that certificate together with the **Login URL** and **Microsoft Entra Identifier** shown in the *Set up Lemma* panel. I will load them on our side and confirm they work.
7. **Users and groups → Add user/group** → add a small test group: yourself and one normal user.
8. **Single sign-on → Test**, signing in as that normal user.

Then give me a shout and I will check the sign-in from our side before you switch it on for everyone. Two things worth doing first: keep one admin account on password + MFA so you can always get back in, and do not enforce SSO for all 40 seats until the test passes.

If anything snags, just reply — nine times out of ten it is a mismatch between someone's sign-in address here and the one we hold for them.

Best,  
Sam
