import admin from "firebase-admin";

/*
 * THE SWAD
 * Admin Authentication Middleware
 *
 * Required request header:
 *
 * Authorization: Bearer <Firebase ID Token>
 *
 * Required Firebase Custom Claim:
 *
 * {
 *   "admin": true
 * }
 *
 * IMPORTANT:
 * Admin status is NEVER trusted from the browser.
 * Firebase Admin SDK verifies the token on the server.
 */

export async function requireAdmin(req, res, next) {
  try {
    const authorization =
      req.headers.authorization || "";

    // -----------------------------------------
    // Check Authorization header
    // -----------------------------------------

    if (!authorization.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Authentication required.",
      });
    }

    const idToken =
      authorization
        .slice(7)
        .trim();

    if (!idToken) {
      return res.status(401).json({
        success: false,
        error: "Authentication token missing.",
      });
    }

    // -----------------------------------------
    // Check Firebase Admin SDK
    // -----------------------------------------

    if (!admin.apps.length) {
      return res.status(500).json({
        success: false,
        error:
          "Authentication service is not configured.",
      });
    }

    // -----------------------------------------
    // Verify Firebase ID token
    //
    // checkRevoked = true
    // means revoked sessions are rejected.
    // -----------------------------------------

    const decodedToken =
      await admin
        .auth()
        .verifyIdToken(
          idToken,
          true
        );

    // -----------------------------------------
    // Verify ADMIN custom claim
    // -----------------------------------------

    if (
      decodedToken.admin !== true
    ) {
      return res.status(403).json({
        success: false,
        error:
          "Admin access required.",
      });
    }

    // -----------------------------------------
    // Store verified admin information
    // for downstream route handlers.
    // -----------------------------------------

    req.admin = {
      uid:
        decodedToken.uid,

      email:
        decodedToken.email ||
        null,
    };

    // -----------------------------------------
    // Authentication successful
    // -----------------------------------------

    next();

  } catch (error) {

    console.error(
      "Admin authentication failed:",
      error.message
    );

    return res.status(401).json({
      success: false,
      error:
        "Invalid or expired authentication token.",
    });
  }
}
