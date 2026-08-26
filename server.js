import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import Razorpay from "razorpay";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import admin from "firebase-admin";
import { requireAdmin } from "./middleware/admin-auth.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 10000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ============================================================
   CONFIG
============================================================ */

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "*";

const ALLOWED_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? null
    : CLIENT_ORIGIN
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);

/* ============================================================
   SECURITY
============================================================ */

app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        !ALLOWED_ORIGINS ||
        ALLOWED_ORIGINS.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error("CORS origin not allowed.")
      );
    },

    methods: [
      "GET",
      "POST",
      "PATCH",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "x-admin-setup-token"
    ]
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

/* ============================================================
   RATE LIMITING
============================================================ */

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false
});

app.use(
  "/api/",
  apiLimiter
);

/* ============================================================
   FIREBASE ADMIN / FIRESTORE
============================================================ */

let db = null;

try {

  const raw =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing."
    );
  }

  const serviceAccount =
    JSON.parse(raw);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential:
        admin.credential.cert(
          serviceAccount
        )
    });
  }

  db = admin.firestore();

  console.log(
    "✓ Firebase Admin + Firestore initialized"
  );

} catch (error) {

  console.error(
    "Firebase initialization failed:",
    error.message
  );

}

/* ============================================================
   RAZORPAY
============================================================ */

const RAZORPAY_KEY_ID =
  process.env.RAZORPAY_KEY_ID;

const RAZORPAY_KEY_SECRET =
  process.env.RAZORPAY_KEY_SECRET;

let razorpay = null;

if (
  RAZORPAY_KEY_ID &&
  RAZORPAY_KEY_SECRET
) {

  razorpay =
    new Razorpay({
      key_id:
        RAZORPAY_KEY_ID,

      key_secret:
        RAZORPAY_KEY_SECRET
    });

  console.log(
    "✓ Razorpay initialized"
  );

} else {

  console.warn(
    "⚠ Razorpay environment variables are missing."
  );

}

/* ============================================================
   BUSINESS
============================================================ */

const BUSINESS = {
  name: "The Swad",
  currency: "INR",

  deliveryFee: 30,

  freeDeliveryMinimum: 500
};

/* ============================================================
   SERVER-SIDE MENU
============================================================ */

/*
  IMPORTANT:

  These prices are authoritative.

  The browser is NOT trusted for prices.

  Replace these products/prices with your actual
  The Swad menu before going live.
*/

const MENU = {

  "special-full-tiffin": {
    id: "special-full-tiffin",
    name: "Special Full Tiffin",
    category: "Tiffin",
    price: 99,
    available: true
  },

  "mini-tiffin": {
    id: "mini-tiffin",
    name: "Mini Tiffin",
    category: "Tiffin",
    price: 69,
    available: true
  },

  "veg-thali": {
    id: "veg-thali",
    name: "Homestyle Veg Thali",
    category: "Tiffin",
    price: 119,
    available: true
  },

  "lunch-combo": {
    id: "lunch-combo",
    name: "Lunch Combo",
    category: "Combos",
    price: 129,
    available: true
  },

  "aloo-paratha": {
    id: "aloo-paratha",
    name: "Aloo Paratha",
    category: "Breakfast",
    price: 59,
    available: true
  },

  "dal-rice": {
    id: "dal-rice",
    name: "Dal Rice",
    category: "Lunch",
    price: 79,
    available: true
  },

  "roti-sabzi": {
    id: "roti-sabzi",
    name: "Roti Sabzi",
    category: "Lunch",
    price: 75,
    available: true
  },

  "paneer-combo": {
    id: "paneer-combo",
    name: "Paneer Special Combo",
    category: "Combos",
    price: 149,
    available: true
  }

};

/* ============================================================
   HELPERS
============================================================ */

function sendError(
  res,
  status,
  message
) {

  return res
    .status(status)
    .json({
      success: false,
      error: message
    });
}


function text(
  value,
  maxLength
) {

  if (
    typeof value !==
    "string"
  ) {

    return "";

  }

  return value
    .trim()
    .slice(
      0,
      maxLength
    );
}


function validPhone(
  phone
) {

  return /^[6-9]\d{9}$/.test(
    phone
  );

}


function validPincode(
  pincode
) {

  return /^[1-9]\d{5}$/.test(
    pincode
  );

}


function requireFirebase() {

  if (!db) {

    throw new Error(
      "Firestore is not configured."
    );

  }

}


function requireRazorpay() {

  if (!razorpay) {

    throw new Error(
      "Razorpay is not configured."
    );

  }

}


function makeOrderId() {

  return (
    "SWAD-" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    "-" +
    crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()
  );

}

/* ============================================================
   CUSTOMER VALIDATION
============================================================ */

function validateCustomer(
  customer
) {

  const value = {

    name:
      text(
        customer?.name,
        80
      ),

    phone:
      text(
        customer?.phone,
        10
      ),

    address:
      text(
        customer?.address,
        300
      ),

    landmark:
      text(
        customer?.landmark,
        100
      ),

    pincode:
      text(
        customer?.pincode,
        6
      ),

    notes:
      text(
        customer?.notes,
        200
      )

  };


  if (
    value.name.length < 2
  ) {

    throw new Error(
      "Invalid customer name."
    );

  }


  if (
    !validPhone(
      value.phone
    )
  ) {

    throw new Error(
      "Invalid mobile number."
    );

  }


  if (
    value.address.length < 8
  ) {

    throw new Error(
      "Invalid delivery address."
    );

  }


  if (
    !validPincode(
      value.pincode
    )
  ) {

    throw new Error(
      "Invalid pincode."
    );

  }


  return value;

}

/* ============================================================
   SERVER-SIDE ORDER CALCULATION
============================================================ */

function calculateOrder(
  items
) {

  if (
    !Array.isArray(items) ||
    items.length === 0
  ) {

    throw new Error(
      "Cart is empty."
    );

  }


  if (
    items.length > 30
  ) {

    throw new Error(
      "Too many different items."
    );

  }


  const normalized = [];

  let subtotal = 0;


  for (
    const raw of items
  ) {

    const id =
      text(
        raw?.id,
        100
      );


    const quantity =
      Number(
        raw?.qty
      );


    if (
      !Number.isInteger(
        quantity
      ) ||
      quantity < 1 ||
      quantity > 20
    ) {

      throw new Error(
        "Invalid item quantity."
      );

    }


    const product =
      MENU[id];


    if (
      !product ||
      product.available !== true
    ) {

      throw new Error(
        `Item unavailable: ${id}`
      );

    }


    const lineTotal =
      product.price *
      quantity;


    normalized.push({

      id:
        product.id,

      name:
        product.name,

      category:
        product.category,

      quantity,

      unitPrice:
        product.price,

      lineTotal

    });


    subtotal +=
      lineTotal;

  }


  const deliveryFee =
    subtotal >=
    BUSINESS.freeDeliveryMinimum
      ? 0
      : BUSINESS.deliveryFee;


  return {

    items:
      normalized,

    subtotal,

    deliveryFee,

    total:
      subtotal +
      deliveryFee,

    currency:
      BUSINESS.currency

  };

}

/* ============================================================
   STATIC FRONTEND
============================================================ */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    )
  )
);

/* ============================================================
   HEALTH
============================================================ */

app.get(
  "/api/health",
  (req, res) => {

    res.json({

      success:
        true,

      service:
        "The Swad API",

      status:
        "online",

      firestore:
        Boolean(db),

      paymentGateway:
        Boolean(razorpay),

      time:
        new Date().toISOString()

    });

  }
);

/* ============================================================
   MENU
============================================================ */

app.get(
  "/api/menu",
  (req, res) => {

    res.json({

      success:
        true,

      business:
        BUSINESS.name,

      currency:
        BUSINESS.currency,

      deliveryFee:
        BUSINESS.deliveryFee,

      freeDeliveryMinimum:
        BUSINESS.freeDeliveryMinimum,

      items:
        Object.values(
          MENU
        )

    });

  }
);

/* ============================================================
   CREATE RAZORPAY ORDER
============================================================ */

app.post(
  "/api/payment/create-order",

  paymentLimiter,

  async (
    req,
    res
  ) => {

    try {

      requireRazorpay();
      requireFirebase();


      const customer =
        validateCustomer(
          req.body?.customer
        );


      const calculation =
        calculateOrder(
          req.body?.items
        );


      const orderId =
        makeOrderId();


      const now =
        new Date()
          .toISOString();


      const razorpayOrder =
        await razorpay.orders.create({

          amount:
            calculation.total *
            100,

          currency:
            "INR",

          receipt:
            orderId,

          notes: {

            business:
              BUSINESS.name,

            internalOrderId:
              orderId

          }

        });


      await db
        .collection(
          "orders"
        )
        .doc(
          orderId
        )
        .set({

          orderId,

          razorpayOrderId:
            razorpayOrder.id,

          customer,

          items:
            calculation.items,

          subtotal:
            calculation.subtotal,

          deliveryFee:
            calculation.deliveryFee,

          total:
            calculation.total,

          currency:
            "INR",

          status:
            "PAYMENT_PENDING",

          paymentStatus:
            "PENDING",

          createdAt:
            now,

          updatedAt:
            now

        });


      return res.json({

        success:
          true,

        order: {

          orderId,

          razorpayOrderId:
            razorpayOrder.id,

          amount:
            calculation.total *
            100,

          currency:
            "INR"

        },

        keyId:
          RAZORPAY_KEY_ID

      });


    } catch (
      error
    ) {

      console.error(
        "Create payment order:",
        error
      );


      return sendError(
        res,
        400,
        error.message ||
          "Unable to create payment order."
      );

    }

  }
);

/* ============================================================
   VERIFY RAZORPAY PAYMENT
============================================================ */

app.post(
  "/api/payment/verify",

  paymentLimiter,

  async (
    req,
    res
  ) => {

    try {

      requireRazorpay();
      requireFirebase();


      const {
        orderId,
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature
      } =
        req.body || {};


      if (
        !orderId ||
        !razorpayOrderId ||
        !razorpayPaymentId ||
        !razorpaySignature
      ) {

        return sendError(
          res,
          400,
          "Incomplete payment verification data."
        );

      }


      const orderRef =
        db
          .collection(
            "orders"
          )
          .doc(
            orderId
          );


      const snapshot =
        await orderRef.get();


      if (
        !snapshot.exists
      ) {

        return sendError(
          res,
          404,
          "Order not found."
        );

      }


      const order =
        snapshot.data();


      if (
        order.razorpayOrderId !==
        razorpayOrderId
      ) {

        return sendError(
          res,
          400,
          "Payment order mismatch."
        );

      }


      /*
        Idempotency:
        Don't process an already paid order twice.
      */

      if (
        order.paymentStatus ===
        "PAID"
      ) {

        return res.json({

          success:
            true,

          verified:
            true,

          alreadyVerified:
            true,

          orderId,

          status:
            order.status

        });

      }


      /*
        Razorpay signature verification
      */

      const generatedSignature =
        crypto
          .createHmac(
            "sha256",
            RAZORPAY_KEY_SECRET
          )
          .update(
            `${razorpayOrderId}|${razorpayPaymentId}`
          )
          .digest(
            "hex"
          );


      const expected =
        Buffer.from(
          generatedSignature,
          "utf8"
        );


      const received =
        Buffer.from(
          String(
            razorpaySignature
          ),
          "utf8"
        );


      if (
        expected.length !==
          received.length ||
        !crypto.timingSafeEqual(
          expected,
          received
        )
      ) {

        return sendError(
          res,
          400,
          "Payment signature verification failed."
        );

      }


      /*
        Verify directly with Razorpay.
      */

      const payment =
        await razorpay
          .payments
          .fetch(
            razorpayPaymentId
          );


      if (
        payment.order_id !==
        razorpayOrderId
      ) {

        return sendError(
          res,
          400,
          "Gateway order mismatch."
        );

      }


      if (
        payment.status !==
        "captured"
      ) {

        return sendError(
          res,
          400,
          `Payment is not captured. Current status: ${payment.status}`
        );

      }


      /*
        Verify exact amount.
      */

      if (
        Number(
          payment.amount
        ) !==
        Number(
          order.total
        ) * 100
      ) {

        return sendError(
          res,
          400,
          "Payment amount mismatch."
        );

      }


      const paidAt =
        new Date()
          .toISOString();


      /*
        Atomic Firestore update.
      */

      await db.runTransaction(
        async (
          transaction
        ) => {

          const latestSnapshot =
            await transaction.get(
              orderRef
            );


          if (
            !latestSnapshot.exists
          ) {

            throw new Error(
              "Order no longer exists."
            );

          }


          const latest =
            latestSnapshot.data();


          if (
            latest.paymentStatus ===
            "PAID"
          ) {

            return;

          }


          transaction.update(
            orderRef,
            {

              paymentStatus:
                "PAID",

              status:
                "NEW",

              razorpayPaymentId,

              razorpaySignatureVerified:
                true,

              paidAt,

              updatedAt:
                paidAt

            }
          );


          transaction.set(

            orderRef
              .collection(
                "paymentEvents"
              )
              .doc(),

            {

              type:
                "PAYMENT_VERIFIED",

              razorpayOrderId,

              razorpayPaymentId,

              amount:
                payment.amount,

              currency:
                payment.currency,

              createdAt:
                paidAt

            }

          );


          transaction.set(

            orderRef
              .collection(
                "statusHistory"
              )
              .doc(),

            {

              from:
                "PAYMENT_PENDING",

              to:
                "NEW",

              changedAt:
                paidAt,

              changedBy:
                "SYSTEM",

              changedByEmail:
                null

            }

          );

        }
      );


      return res.json({

        success:
          true,

        verified:
          true,

        orderId,

        status:
          "NEW"

      });


    } catch (
      error
    ) {

      console.error(
        "Payment verification:",
        error
      );


      return sendError(
        res,
        500,
        "Payment verification failed."
      );

    }

  }
);
/* ============================================================
   CUSTOMER ORDER LOOKUP
============================================================ */

app.post(
  "/api/orders/lookup",

  async (
    req,
    res
  ) => {

    try {

      requireFirebase();


      const orderId =
        text(
          req.body?.orderId,
          100
        );


      const phone =
        text(
          req.body?.phone,
          10
        );


      if (
        !orderId ||
        !validPhone(
          phone
        )
      ) {

        return sendError(
          res,
          400,
          "Invalid lookup details."
        );

      }


      const snapshot =
        await db
          .collection(
            "orders"
          )
          .doc(
            orderId
          )
          .get();


      if (
        !snapshot.exists
      ) {

        return sendError(
          res,
          404,
          "Order not found."
        );

      }


      const order =
        snapshot.data();


      /*
        Phone acts as second factor for lookup.
      */

      if (
        order.customer?.phone !==
        phone
      ) {

        return sendError(
          res,
          404,
          "Order not found."
        );

      }


      return res.json({

        success:
          true,

        order: {

          orderId:
            order.orderId,

          status:
            order.status,

          paymentStatus:
            order.paymentStatus,

          total:
            order.total,

          currency:
            order.currency,

          createdAt:
            order.createdAt,

          updatedAt:
            order.updatedAt,

          paidAt:
            order.paidAt ||
            null

        }

      });


    } catch (
      error
    ) {

      console.error(
        "Customer order lookup:",
        error
      );


      return sendError(
        res,
        500,
        "Unable to retrieve order."
      );

    }

  }
);


/* ============================================================
   CUSTOMER TRACKING
============================================================ */

app.get(
  "/api/orders/:orderId",

  async (
    req,
    res
  ) => {

    try {

      requireFirebase();


      const orderId =
        text(
          req.params.orderId,
          100
        );


      const snapshot =
        await db
          .collection(
            "orders"
          )
          .doc(
            orderId
          )
          .get();


      if (
        !snapshot.exists
      ) {

        return sendError(
          res,
          404,
          "Order not found."
        );

      }


      const order =
        snapshot.data();


      return res.json({

        success:
          true,

        order: {

          orderId:
            order.orderId,

          status:
            order.status,

          paymentStatus:
            order.paymentStatus,

          total:
            order.total,

          currency:
            order.currency,

          createdAt:
            order.createdAt,

          updatedAt:
            order.updatedAt,

          paidAt:
            order.paidAt ||
            null

        }

      });


    } catch (
      error
    ) {

      console.error(
        "Order tracking:",
        error
      );


      return sendError(
        res,
        500,
        "Unable to retrieve order."
      );

    }

  }
);


/* ============================================================
   TEMPORARY ADMIN CLAIM SETUP
============================================================ */

/*
  IMPORTANT:

  This endpoint is ONLY for the initial Firebase
  administrator setup.

  Render Environment Variable required:

      ADMIN_SETUP_TOKEN

  Request:

      POST /api/setup/admin-claim

  Header:

      x-admin-setup-token: <ADMIN_SETUP_TOKEN>

  JSON body:

      {
        "email": "your-admin-email@example.com"
      }

  After successfully assigning the claim:

  1. Remove this endpoint from server.js.
  2. Remove ADMIN_SETUP_TOKEN from Render.
  3. Redeploy.

  Do NOT leave this endpoint enabled permanently.
*/

app.post(
  "/api/setup/admin-claim",

  async (
    req,
    res
  ) => {

    try {

      const configuredToken =
        process.env
          .ADMIN_SETUP_TOKEN;


      /*
        Endpoint remains unavailable unless
        the setup token exists in the environment.
      */

      if (
        !configuredToken
      ) {

        return sendError(
          res,
          404,
          "Not found."
        );

      }


      const suppliedToken =
        text(
          req.headers[
            "x-admin-setup-token"
          ],
          500
        );


      if (
        !suppliedToken ||
        suppliedToken !==
          configuredToken
      ) {

        return sendError(
          res,
          401,
          "Unauthorized."
        );

      }


      requireFirebase();


      const email =
        text(
          req.body?.email,
          200
        ).toLowerCase();


      if (
        !email ||
        !email.includes("@")
      ) {

        return sendError(
          res,
          400,
          "Valid admin email is required."
        );

      }


      const user =
        await admin
          .auth()
          .getUserByEmail(
            email
          );


      /*
        Preserve any existing custom claims
        and only add admin: true.
      */

      const existingClaims =
        user.customClaims || {};


      await admin
        .auth()
        .setCustomUserClaims(
          user.uid,
          {
            ...existingClaims,
            admin: true
          }
        );


      console.log(
        `✓ Admin claim assigned: ${email}`
      );


      return res.json({

        success:
          true,

        message:
          "Administrator claim assigned successfully.",

        uid:
          user.uid,

        email:
          user.email,

        admin:
          true

      });


    } catch (
      error
    ) {

      console.error(
        "Admin claim setup:",
        error
      );


      if (
        error.code ===
        "auth/user-not-found"
      ) {

        return sendError(
          res,
          404,
          "Firebase Authentication user not found."
        );

      }


      return sendError(
        res,
        500,
        "Unable to assign administrator claim."
      );

    }

  }
);


/* ============================================================
   ADMIN STATUS CONFIG
============================================================ */

const STATUSES =
  new Set([

    "NEW",

    "ACCEPTED",

    "PREPARING",

    "READY",

    "DISPATCHED",

    "DELIVERED",

    "CANCELLED"

  ]);


const TRANSITIONS = {

  NEW:
    new Set([
      "ACCEPTED",
      "CANCELLED"
    ]),

  ACCEPTED:
    new Set([
      "PREPARING",
      "CANCELLED"
    ]),

  PREPARING:
    new Set([
      "READY",
      "CANCELLED"
    ]),

  READY:
    new Set([
      "DISPATCHED",
      "CANCELLED"
    ]),

  DISPATCHED:
    new Set([
      "DELIVERED"
    ]),

  DELIVERED:
    new Set(),

  CANCELLED:
    new Set()

};


/* ============================================================
   ADMIN ORDERS
============================================================ */

app.get(
  "/api/admin/orders",

  requireAdmin,

  async (
    req,
    res
  ) => {

    try {

      requireFirebase();


      const requestedStatus =
        text(
          req.query.status ||
            "",
          30
        )
        .toUpperCase();


      const requestedLimit =
        Number(
          req.query.limit ||
            100
        );


      const limit =
        Math.min(
          Math.max(
            Number.isInteger(
              requestedLimit
            )
              ? requestedLimit
              : 100,
            1
          ),
          100
        );


      if (
        requestedStatus &&
        !STATUSES.has(
          requestedStatus
        )
      ) {

        return sendError(
          res,
          400,
          "Invalid order status."
        );

      }


      const snapshot =
        await db
          .collection(
            "orders"
          )
          .get();


      let orders =
        snapshot.docs.map(
          (
            doc
          ) => ({

            id:
              doc.id,

            ...doc.data()

          })
        );


      if (
        requestedStatus
      ) {

        orders =
          orders.filter(
            (
              order
            ) =>
              String(
                order.status ||
                  ""
              )
                .toUpperCase() ===
              requestedStatus
          );

      }


      orders.sort(
        (
          a,
          b
        ) => {

          const at =
            Date.parse(
              a.createdAt ||
                ""
            ) ||
            0;


          const bt =
            Date.parse(
              b.createdAt ||
                ""
            ) ||
            0;


          return (
            bt -
            at
          );

        }
      );


      return res.json({

        success:
          true,

        count:
          Math.min(
            orders.length,
            limit
          ),

        orders:
          orders.slice(
            0,
            limit
          )

      });


    } catch (
      error
    ) {

      console.error(
        "Admin order list:",
        error
      );


      return sendError(
        res,
        500,
        "Unable to retrieve admin orders."
      );

    }

  }
);


/* ============================================================
   ADMIN SINGLE ORDER
============================================================ */

app.get(
  "/api/admin/orders/:orderId",

  requireAdmin,

  async (
    req,
    res
  ) => {

    try {

      requireFirebase();


      const orderId =
        text(
          req.params.orderId,
          100
        );


      const orderRef =
        db
          .collection(
            "orders"
          )
          .doc(
            orderId
          );


      const snapshot =
        await orderRef.get();


      if (
        !snapshot.exists
      ) {

        return sendError(
          res,
          404,
          "Order not found."
        );

      }


      const historySnapshot =
        await orderRef
          .collection(
            "statusHistory"
          )
          .orderBy(
            "changedAt",
            "desc"
          )
          .limit(
            50
          )
          .get();


      const statusHistory =
        historySnapshot.docs.map(
          (
            doc
          ) => ({

            id:
              doc.id,

            ...doc.data()

          })
        );


      return res.json({

        success:
          true,

        order: {

          id:
            snapshot.id,

          ...snapshot.data(),

          statusHistory

        }

      });


    } catch (
      error
    ) {

      console.error(
        "Admin order detail:",
        error
      );


      return sendError(
        res,
        500,
        "Unable to retrieve order."
      );

    }

  }
);
/* ============================================================
   ADMIN STATUS UPDATE
============================================================ */

app.patch(
  "/api/admin/orders/:orderId/status",

  requireAdmin,

  async (
    req,
    res
  ) => {

    try {

      requireFirebase();


      const orderId =
        text(
          req.params.orderId,
          100
        );


      const nextStatus =
        text(
          req.body?.status,
          30
        )
        .toUpperCase();


      if (
        !STATUSES.has(
          nextStatus
        )
      ) {

        return sendError(
          res,
          400,
          "Invalid order status."
        );
      }


      const orderRef =
        db
          .collection(
            "orders"
          )
          .doc(
            orderId
          );


      const result =
        await db.runTransaction(
          async (
            transaction
          ) => {

            const snapshot =
              await transaction.get(
                orderRef
              );


            if (
              !snapshot.exists
            ) {

              throw new Error(
                "ORDER_NOT_FOUND"
              );
            }


            const order =
              snapshot.data();


            const currentStatus =
              String(
                order.status ||
                  ""
              )
                .toUpperCase();


            if (
              order.paymentStatus !==
              "PAID"
            ) {

              throw new Error(
                "ORDER_NOT_PAID"
              );
            }


            if (
              currentStatus ===
              nextStatus
            ) {

              return {

                already:
                  true,

                previous:
                  currentStatus,

                status:
                  currentStatus

              };
            }


            if (
              !TRANSITIONS[
                currentStatus
              ]?.has(
                nextStatus
              )
            ) {

              throw new Error(
                "INVALID_TRANSITION"
              );
            }


            const now =
              new Date()
                .toISOString();


            transaction.update(
              orderRef,
              {

                status:
                  nextStatus,

                updatedAt:
                  now,

                lastUpdatedBy:
                  req.admin.uid

              }
            );


            transaction.set(

              orderRef
                .collection(
                  "statusHistory"
                )
                .doc(),

              {

                from:
                  currentStatus,

                to:
                  nextStatus,

                changedAt:
                  now,

                changedBy:
                  req.admin.uid,

                changedByEmail:
                  req.admin.email ||
                  null

              }

            );


            return {

              already:
                false,

              previous:
                currentStatus,

              status:
                nextStatus,

              updatedAt:
                now

            };

          }
        );


      return res.json({

        success:
          true,

        orderId,

        previousStatus:
          result.previous,

        status:
          result.status,

        updatedAt:
          result.updatedAt ||
          null,

        already:
          result.already ||
          false

      });


    } catch (
      error
    ) {

      console.error(
        "Admin status update:",
        error
      );


      if (
        error.message ===
        "ORDER_NOT_FOUND"
      ) {

        return sendError(
          res,
          404,
          "Order not found."
        );
      }


      if (
        error.message ===
        "ORDER_NOT_PAID"
      ) {

        return sendError(
          res,
          409,
          "Only paid orders can be processed."
        );
      }


      if (
        error.message ===
        "INVALID_TRANSITION"
      ) {

        return sendError(
          res,
          409,
          "Invalid order status transition."
        );
      }


      return sendError(
        res,
        500,
        "Unable to update order status."
      );
    }
  }
);


/* ============================================================
   ADMIN STATS
============================================================ */

app.get(
  "/api/admin/stats",

  requireAdmin,

  async (
    req,
    res
  ) => {

    try {

      requireFirebase();


      const snapshot =
        await db
          .collection(
            "orders"
          )
          .get();


      const stats = {

        total:
          0,

        new:
          0,

        accepted:
          0,

        preparing:
          0,

        ready:
          0,

        dispatched:
          0,

        delivered:
          0,

        cancelled:
          0,

        paid:
          0,

        pendingPayment:
          0

      };


      for (
        const doc of
        snapshot.docs
      ) {

        const order =
          doc.data();


        stats.total++;


        const status =
          String(
            order.status ||
              ""
          )
            .toLowerCase();


        const payment =
          String(
            order.paymentStatus ||
              ""
          )
            .toLowerCase();


        if (
          Object.hasOwn(
            stats,
            status
          )
        ) {

          stats[
            status
          ]++;
        }


        if (
          payment ===
          "paid"
        ) {

          stats.paid++;
        }


        if (
          payment ===
          "pending"
        ) {

          stats.pendingPayment++;
        }

      }


      return res.json({

        success:
          true,

        stats

      });


    } catch (
      error
    ) {

      console.error(
        "Admin stats:",
        error
      );


      return sendError(
        res,
        500,
        "Unable to retrieve dashboard statistics."
      );
    }
  }
);


/* ============================================================
   ADMIN PAGE
============================================================ */

app.get(
  "/admin",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin",
        "index.html"
      )
    );

  }
);


app.get(
  "/admin/",
  (req, res) => {

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "admin",
        "index.html"
      )
    );

  }
);


/* ============================================================
   API 404
============================================================ */

app.use(
  "/api",
  (req, res) => {

    return sendError(
      res,
      404,
      "API endpoint not found."
    );

  }
);


/* ============================================================
   GLOBAL ERROR HANDLER
============================================================ */

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Unhandled server error:",
      error
    );


    if (
      res.headersSent
    ) {

      return next(
        error
      );
    }


    return res
      .status(500)
      .json({

        success:
          false,

        error:
          "Internal server error."

      });

  }
);


/* ============================================================
   START SERVER
============================================================ */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "========================================"
    );

    console.log(
      "          THE SWAD SERVER"
    );

    console.log(
      "========================================"
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Environment: ${
        process.env.NODE_ENV ||
        "development"
      }`
    );

    console.log(
      `Firestore: ${
        db
          ? "READY"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      `Razorpay: ${
        razorpay
          ? "READY"
          : "NOT CONFIGURED"
      }`
    );

    console.log(
      "========================================"
    );

  }
);
