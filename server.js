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

/* =========================================================
   THE SWAD
   Firestore + Razorpay Production Server
   ========================================================= */

const app = express();

const PORT = Number(process.env.PORT || 10000);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* =========================================================
   CONFIG
   ========================================================= */

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "*";

const ALLOWED_ORIGINS =
  CLIENT_ORIGIN === "*"
    ? null
    : CLIENT_ORIGIN
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

/* =========================================================
   SECURITY
   ========================================================= */

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
      if (!origin) {
        return callback(null, true);
      }

      if (!ALLOWED_ORIGINS) {
        return callback(null, true);
      }

      if (ALLOWED_ORIGINS.includes(origin)) {
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
      "Authorization"
    ]
  })
);

app.use(
  express.json({
    limit: "100kb"
  })
);

/* =========================================================
   RATE LIMITING
   ========================================================= */

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many requests. Please try again later."
  }
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,

  message: {
    success: false,
    error:
      "Too many payment requests. Please try again later."
  }
});

app.use(
  "/api/",
  apiLimiter
);

/* =========================================================
   FIREBASE ADMIN / FIRESTORE
   ========================================================= */

let db = null;

try {
  const serviceAccountJSON =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJSON) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing."
    );
  }

  const serviceAccount =
    JSON.parse(
      serviceAccountJSON
    );

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

/* =========================================================
   RAZORPAY
   ========================================================= */

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

/* =========================================================
   BUSINESS
   ========================================================= */

const BUSINESS = {
  name: "The Swad",
  currency: "INR",

  deliveryFee: 30,

  freeDeliveryMinimum: 500
};

/* =========================================================
   MENU
   ========================================================= */

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

/* =========================================================
   HELPERS
   ========================================================= */

function sendError(
  res,
  status,
  message
) {
  return res.status(status).json({
    success: false,
    error: message
  });
}

function sanitizeText(
  value,
  maxLength
) {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .slice(0, maxLength);
}

function validatePhone(
  phone
) {
  return /^[6-9]\d{9}$/.test(
    phone
  );
}

function validatePincode(
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
  const timestamp =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase();

  return `SWAD-${timestamp}-${random}`;
}

/* =========================================================
   CUSTOMER VALIDATION
   ========================================================= */

function validateCustomer(
  customer
) {
  const name =
    sanitizeText(
      customer?.name,
      80
    );

  const phone =
    sanitizeText(
      customer?.phone,
      10
    );

  const address =
    sanitizeText(
      customer?.address,
      300
    );

  const landmark =
    sanitizeText(
      customer?.landmark,
      100
    );

  const pincode =
    sanitizeText(
      customer?.pincode,
      6
    );

  const notes =
    sanitizeText(
      customer?.notes,
      200
    );

  if (
    name.length < 2
  ) {
    throw new Error(
      "Invalid customer name."
    );
  }

  if (
    !validatePhone(phone)
  ) {
    throw new Error(
      "Invalid mobile number."
    );
  }

  if (
    address.length < 8
  ) {
    throw new Error(
      "Invalid delivery address."
    );
  }

  if (
    !validatePincode(
      pincode
    )
  ) {
    throw new Error(
      "Invalid pincode."
    );
  }

  return {
    name,
    phone,
    address,
    landmark,
    pincode,
    notes
  };
}

/* =========================================================
   SERVER-SIDE ORDER CALCULATION
   ========================================================= */

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

  const normalizedItems = [];

  let subtotal = 0;

  for (
    const rawItem of items
  ) {
    const id =
      sanitizeText(
        rawItem?.id,
        100
      );

    const quantity =
      Number(
        rawItem?.qty
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

    normalizedItems.push({
      id: product.id,
      name: product.name,
      category: product.category,
      quantity,
      unitPrice: product.price,
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

  const total =
    subtotal +
    deliveryFee;

  return {
    items:
      normalizedItems,

    subtotal,

    deliveryFee,

    total,

    currency:
      BUSINESS.currency
  };
}

/* =========================================================
   STATIC FILES
   ========================================================= */

app.use(
  express.static(
    path.join(
      __dirname,
      "public"
    ),
    {
      extensions: [
        "html"
      ]
    }
  )
);

/* =========================================================
   HEALTH
   ========================================================= */

app.get(
  "/api/health",
  (req, res) => {
    res.json({
      success: true,

      service:
        "The Swad API",

      status:
        "online",

      environment:
        process.env.NODE_ENV ||
        "development",

      firebase:
        Boolean(db),

      firestore:
        Boolean(db),

      razorpay:
        Boolean(razorpay),

      timestamp:
        new Date().toISOString()
    });
  }
);

/* =========================================================
   MENU
   ========================================================= */

app.get(
  "/api/menu",
  (req, res) => {
    res.json({
      success: true,

      business:
        BUSINESS.name,

      currency:
        BUSINESS.currency,

      deliveryFee:
        BUSINESS.deliveryFee,

      freeDeliveryMinimum:
        BUSINESS.freeDeliveryMinimum,

      items:
        Object.values(MENU)
    });
  }
);

/* =========================================================
   CREATE RAZORPAY ORDER
   ========================================================= */

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

      const razorpayOrder =
        await razorpay.orders.create({
          amount:
            calculation.total * 100,

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

      const now =
        new Date().toISOString();

      const pendingOrder = {
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
          calculation.currency,

        status:
          "PAYMENT_PENDING",

        paymentStatus:
          "PENDING",

        createdAt:
          now,

        updatedAt:
          now
      };

      await db
        .collection("orders")
        .doc(orderId)
        .set(
          pendingOrder
        );

      return res.json({
        success: true,

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

    } catch (error) {
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

/* =========================================================
   VERIFY RAZORPAY PAYMENT
   ========================================================= */

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
          .collection("orders")
          .doc(orderId);

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
       * Idempotency.
       */

      if (
        order.paymentStatus ===
        "PAID"
      ) {
        return res.json({
          success: true,

          verified: true,

          alreadyVerified:
            true,

          orderId,

          status:
            order.status
        });
      }

      /*
       * Verify Razorpay signature.
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
          .digest("hex");

      const received =
        Buffer.from(
          String(
            razorpaySignature
          ),
          "utf8"
        );

      const expected =
        Buffer.from(
          generatedSignature,
          "utf8"
        );

      const signatureValid =
        received.length ===
          expected.length &&
        crypto.timingSafeEqual(
          expected,
          received
        );

      if (
        !signatureValid
      ) {
        return sendError(
          res,
          400,
          "Payment signature verification failed."
        );
      }

      /*
       * Fetch payment from Razorpay.
       */

      const payment =
        await razorpay.payments.fetch(
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

      const expectedAmount =
        Number(
          order.total
        ) * 100;

      if (
        Number(
          payment.amount
        ) !==
        expectedAmount
      ) {
        return sendError(
          res,
          400,
          "Payment amount mismatch."
        );
      }

      const paidAt =
        new Date().toISOString();

      /*
       * Firestore transaction prevents
       * duplicate verification updates.
       */

      await db.runTransaction(
        async (transaction) => {
          const latest =
            await transaction.get(
              orderRef
            );

          if (
            !latest.exists
          ) {
            throw new Error(
              "Order no longer exists."
            );
          }

          const latestOrder =
            latest.data();

          if (
            latestOrder.paymentStatus ===
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
        }
      );

      return res.json({
        success: true,

        verified: true,

        orderId,

        status:
          "NEW"
      });

    } catch (error) {
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

/* =========================================================
   CUSTOMER ORDER TRACKING
   ========================================================= */

app.get(
  "/api/orders/:orderId",
  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const orderId =
        sanitizeText(
          req.params.orderId,
          100
        );

      if (!orderId) {
        return sendError(
          res,
          400,
          "Invalid order ID."
        );
      }

      const snapshot =
        await db
          .collection("orders")
          .doc(orderId)
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
       * Only safe tracking information
       * is exposed.
       */

      return res.json({
        success: true,

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

    } catch (error) {
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

/* =========================================================
   CUSTOMER ORDER LOOKUP
   ========================================================= */

app.post(
  "/api/orders/lookup",
  apiLimiter,

  async (
    req,
    res
  ) => {
    try {
      requireFirebase();

      const orderId =
        sanitizeText(
          req.body?.orderId,
          100
        );

      const phone =
        sanitizeText(
          req.body?.phone,
          10
        );

      if (
        !orderId ||
        !validatePhone(phone)
      ) {
        return sendError(
          res,
          400,
          "Invalid lookup details."
        );
      }

      const snapshot =
        await db
          .collection("orders")
          .doc(orderId)
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
        success: true,

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

    } catch (error) {
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

/* =========================================================
   ADMIN STATUS CONFIG
   ========================================================= */

const ADMIN_ORDER_STATUSES =
  new Set([
    "NEW",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "DISPATCHED",
    "DELIVERED",
    "CANCELLED"
  ]);

const ALLOWED_STATUS_TRANSITIONS = {
  NEW: new Set([
    "ACCEPTED",
    "CANCELLED"
  ]),

  ACCEPTED: new Set([
    "PREPARING",
    "CANCELLED"
  ]),

  PREPARING: new Set([
    "READY",
    "CANCELLED"
  ]),

  READY: new Set([
    "DISPATCHED",
    "CANCELLED"
  ]),

  DISPATCHED: new Set([
    "DELIVERED"
  ]),

  DELIVERED:
    new Set(),

  CANCELLED:
    new Set()
};

/* =========================================================
   ADMIN - LIST ORDERS
   ========================================================= */

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
        sanitizeText(
          req.query.status ||
            "",
          30
        ).toUpperCase();

      const requestedLimit =
        Number(
          req.query.limit || 50
        );

      const limit =
        Math.min(
          Math.max(
            Number.isInteger(
              requestedLimit
            )
              ? requestedLimit
              : 50,
            1
          ),
          100
        );

      if (
        requestedStatus &&
        !ADMIN_ORDER_STATUSES.has(
          requestedStatus
        )
      ) {
        return sendError(
          res,
          400,
          "Invalid order status."
        );
      }

      /*
       * Simple server-side query.
       * Sorting is done in JS so the first
       * version doesn't require a Firestore
       * composite index.
       */

      const snapshot =
        await db
          .collection("orders")
          .get();

      if (
        snapshot.empty
      ) {
        return res.json({
          success: true,
          count: 0,
          orders: []
        });
      }

      let orders =
        snapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...doc.data()
          })
        );

      if (
        requestedStatus
      ) {
        orders =
          orders.filter(
            (order) =>
              String(
                order.status || ""
              ).toUpperCase() ===
              requestedStatus
          );
      }

      orders.sort(
        (a, b) => {
          const aTime =
            Date.parse(
              a.createdAt || ""
            ) || 0;

          const bTime =
            Date.parse(
              b.createdAt || ""
            ) || 0;

          return (
            bTime -
            aTime
          );
        }
      );

      orders =
        orders.slice(
          0,
          limit
        );

      return res.json({
        success: true,

        count:
          orders.length,

        orders
      });

    } catch (error) {
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

/* =========================================================
   ADMIN - SINGLE ORDER
   ========================================================= */

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
        sanitizeText(
          req.params.orderId,
          100
        );

      if (!orderId) {
        return sendError(
          res,
          400,
          "Invalid order ID."
        );
      }

      const snapshot =
        await db
          .collection("orders")
          .doc(orderId)
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

      const historySnapshot =
        await db
          .collection("orders")
          .doc(orderId)
          .collection(
            "statusHistory"
          )
          .orderBy(
            "changedAt",
            "desc"
          )
          .limit(50)
          .get();

      const statusHistory =
        historySnapshot.docs.map(
          (doc) => ({
            id: doc.id,
            ...doc.data()
          })
        );

      return res.json({
        success: true,

        order: {
          id: snapshot.id,

          ...snapshot.data(),

          statusHistory
        }
      });

    } catch (error) {
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

/* =========================================================
   ADMIN - UPDATE STATUS
   ========================================================= */

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
        sanitizeText(
          req.params.orderId,
          100
        );

      const nextStatus =
        sanitizeText(
          req.body?.status,
          30
        ).toUpperCase();

      if (!orderId) {
        return sendError(
          res,
          400,
          "Invalid order ID."
        );
      }

      if (
        !ADMIN_ORDER_STATUSES.has(
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
          .collection("orders")
          .doc(orderId);

      const result =
        await db.runTransaction(
          async (transaction) => {
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
                order.status || ""
              ).toUpperCase();

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

            const allowedNext =
              ALLOWED_STATUS_TRANSITIONS[
                currentStatus
              ];

            if (
              !allowedNext ||
              !allowedNext.has(
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

            const historyRef =
              orderRef
                .collection(
                  "statusHistory"
                )
                .doc();

            transaction.set(
              historyRef,
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

      if (
        result.already
      ) {
        return res.json({
          success: true,

          message:
            "Order already has this status.",

          orderId,

          status:
            result.status
        });
      }

      return res.json({
        success: true,

        orderId,

        previousStatus:
          result.previous,

        status:
          result.status,

        updatedAt:
          result.updatedAt
      });

    } catch (error) {
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

/* =========================================================
   ADMIN - DASHBOARD STATS
   ========================================================= */

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
          .collection("orders")
          .get();

      const stats = {
        total: 0,

        new: 0,

        accepted: 0,

        preparing: 0,

        ready: 0,

        dispatched: 0,

        delivered: 0,

        cancelled: 0,

        paid: 0,

        pendingPayment: 0
      };

      for (
        const doc of snapshot.docs
      ) {
        const order =
          doc.data();

        stats.total++;

        const status =
          String(
            order.status || ""
          ).toLowerCase();

        const paymentStatus =
          String(
            order.paymentStatus ||
              ""
          ).toLowerCase();

        if (
          Object.hasOwn(
            stats,
            status
          )
        ) {
          stats[status]++;
        }

        if (
          paymentStatus ===
          "paid"
        ) {
          stats.paid++;
        }

        if (
          paymentStatus ===
          "pending"
        ) {
          stats.pendingPayment++;
        }
      }

      return res.json({
        success: true,

        stats
      });

    } catch (error) {
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

/* =========================================================
   ADMIN PAGE
   ========================================================= */

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

/* =========================================================
   API 404
   ========================================================= */

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

/* =========================================================
   GLOBAL ERROR HANDLER
   ========================================================= */

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
      return next(error);
    }

    return res
      .status(500)
      .json({
        success: false,

        error:
          "Internal server error."
      });
  }
);

/* =========================================================
   START
   ========================================================= */

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