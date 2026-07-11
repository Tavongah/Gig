import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { AppButton } from "./AppButton";

interface StripeCardFormProps {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  onSuccess: () => void;
  onError: (message: string) => void;
  onUseCheckout?: () => void;
}

type StripeInstance = {
  elements: (options: { clientSecret: string; appearance?: Record<string, unknown> }) => StripeElements;
  confirmPayment: (options: {
    elements: StripeElements;
    confirmParams: { return_url: string };
    redirect: "if_required";
  }) => Promise<{ error?: { message?: string }; paymentIntent?: { status: string } }>;
};

type StripePaymentElement = {
  mount: (element: HTMLElement) => void;
  destroy: () => void;
};

type StripeElements = {
  create: (type: "payment") => StripePaymentElement;
};

declare global {
  interface Window {
    Stripe?: (key: string) => StripeInstance;
  }
}

let stripeScriptPromise: Promise<void> | null = null;

function loadStripeScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Stripe) return Promise.resolve();
  if (stripeScriptPromise) return stripeScriptPromise;

  stripeScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="https://js.stripe.com/v3/"]');
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Stripe.js")));
      return;
    }

    const script = document.createElement("script");
    script.src = "https://js.stripe.com/v3/";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Stripe.js"));
    document.head.appendChild(script);
  });

  return stripeScriptPromise;
}

export function StripeCardForm({ publishableKey, clientSecret, amountLabel, onSuccess, onError }: StripeCardFormProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const stripeRef = useRef<StripeInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let mounted = true;
    let paymentElement: StripePaymentElement | null = null;

    void loadStripeScript()
      .then(() => {
        if (!mounted || !mountRef.current || !window.Stripe) return;

        const stripe = window.Stripe(publishableKey);
        const elements = stripe.elements({
          clientSecret,
          appearance: {
            theme: "stripe",
            variables: {
              colorPrimary: "#6A1B9A",
              borderRadius: "16px"
            }
          }
        });

        paymentElement = elements.create("payment");
        paymentElement.mount(mountRef.current);
        stripeRef.current = stripe;
        elementsRef.current = elements;
        setReady(true);
      })
      .catch((error: Error) => onError(error.message));

    return () => {
      mounted = false;
      paymentElement?.destroy();
      elementsRef.current = null;
      stripeRef.current = null;
      setReady(false);
    };
  }, [publishableKey, clientSecret, onError]);

  async function handleSubmit(): Promise<void> {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) {
      onError("Card form is still loading. Try again in a moment.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: "if_required"
      });

      if (result.error?.message) {
        onError(result.error.message);
        return;
      }

      const status = result.paymentIntent?.status;
      if (status === "requires_capture" || status === "succeeded" || status === "processing") {
        onSuccess();
        return;
      }

      onError("Payment could not be completed. Check your card details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View className="gap-4">
      <View className="overflow-hidden rounded-3xl border border-border bg-white p-4">
        <div ref={mountRef} style={{ minHeight: ready ? 220 : 120 }} />
      </View>
      {!ready ? <Text className="text-center text-sm text-muted">Loading secure card form...</Text> : null}
      <AppButton
        label={submitting ? "Processing payment..." : `Pay ${amountLabel}`}
        onPress={() => void handleSubmit()}
        loading={submitting}
        disabled={!ready || submitting}
      />
      <Text className="text-center text-xs text-muted">Secured by Stripe. Your card is authorized, not charged until the gig completes.</Text>
    </View>
  );
}
