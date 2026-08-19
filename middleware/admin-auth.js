import admin from "firebase-admin";

/*
============================================================
THE SWAD
ADMIN AUTHENTICATION MIDDLEWARE
============================================================

Flow:

Admin Browser
     ↓
Firebase Authentication
     ↓
Firebase ID Token
     ↓
Authorization: Bearer <token>
     ↓
Express Server
     ↓
Firebase Admin SDK
     ↓
Verify ID Token
     ↓
Check custom claim:
admin === true
     ↓
Allow Admin API
============================================================
*/

export async function requireAdmin(
  req,
  res,
  next
) {
  try {

    /* ------------------------------------------------------
       Firebase Admin must be initialized
    ------------------------------------------------------ */

    if (!admin.apps.length) {
      return res.status(500).json({
        success: false,
        error:
          "Firebase Admin authentication is not configured."
      });
    }


    /* ------------------------------------------------------
       Read Authorization header
    ------------------------------------------------------ */

    const authorization =
      req.headers.authorization || "";


    /* ------------------------------------------------------
       Require Bearer token
    ------------------------------------------------------ */

    if (
      !authorization.startsWith(
        "Bearer "
      )
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication required."
      });
    }


    /* ------------------------------------------------------
       Extract Firebase ID token
    ------------------------------------------------------ */

    const idToken =
      authorization
        .slice(7)
        .trim();


    if (!idToken) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication token missing."
      });
    }


    /* ------------------------------------------------------
       Verify Firebase ID token
    ------------------------------------------------------

       checkRevoked = true

       This means a revoked Firebase session/token
       will not be accepted.
    */

    const decodedToken =
      await admin
        .auth()
        .verifyIdToken(
          idToken,
          true
        );


    /* ------------------------------------------------------
       Verify ADMIN custom claim
    ------------------------------------------------------

       Firebase Authentication alone does NOT make
       somebody an administrator.

       The account must contain:

           admin: true

       This claim is assigned by the trusted
       make-admin script.
    */

    if (
      decodedToken.admin !== true
    ) {
      return res.status(403).json({
        success: false,
        error:
          "Administrator access required."
      });
    }


    /* ------------------------------------------------------
       Attach trusted admin information
       to the Express request
    ------------------------------------------------------ */

    req.admin = {
      uid:
        decodedToken.uid,

      email:
        decodedToken.email ||
        null,

      name:
        decodedToken.name ||
        null
    };


    /* ------------------------------------------------------
       Continue to protected route
    ------------------------------------------------------ */

    return next();

  } catch (error) {

    console.error(
      "Admin authentication failed:",
      error.message
    );


    /*
    --------------------------------------------------------
    Firebase token errors
    --------------------------------------------------------
    */

    if (
      error.code ===
      "auth/id-token-expired"
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication session expired. Please sign in again."
      });
    }


    if (
      error.code ===
      "auth/id-token-revoked"
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Authentication session has been revoked."
      });
    }


    if (
      error.code ===
      "auth/argument-error"
    ) {
      return res.status(401).json({
        success: false,
        error:
          "Invalid authentication token."
      });
    }


    /*
    --------------------------------------------------------
    Generic authentication failure
    --------------------------------------------------------
    */

    return res.status(401).json({
      success: false,
      error:
        "Authentication failed."
    });
  }
}