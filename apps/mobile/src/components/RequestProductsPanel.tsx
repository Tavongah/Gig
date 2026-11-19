import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useSessionStore } from "../stores/session.store";
import { useShopAreaStore } from "../stores/shop-area.store";
import { DUTS } from "../lib/theme";
import {
  REQUEST_PRODUCT_LIMIT,
  buildRequestProductsWhatsAppUrl,
  emptyRequestProduct,
  formatRequestProductsMessage,
  requestProductsDestinationDigits,
  validateRequestProducts,
  type RequestProductDraft,
  type RequestProductsErrors
} from "../lib/request-products-whatsapp";

type Props = {
  searchQuery: string;
};

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RequestProductsPanel({ searchQuery }: Props) {
  const profile = useSessionStore((state) => state.profile);
  const sessionUser = useSessionStore((state) => state.session?.user);
  const areaName = useShopAreaStore((state) => state.area?.name);
  const knownPhone = profile?.phoneNumber?.trim() || sessionUser?.phoneNumber?.trim() || "";
  const knownCity = profile?.city?.trim() || areaName?.trim() || "";
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<RequestProductDraft[]>(() => [
    emptyRequestProduct(nextId(), searchQuery.trim())
  ]);
  const [whatsappNumber, setWhatsappNumber] = useState(knownPhone);
  const [deliveryCity, setDeliveryCity] = useState(knownCity);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<RequestProductsErrors>({ products: {} });
  const [openError, setOpenError] = useState("");

  const prefill = useMemo(
    () => ({ phone: knownPhone, city: knownCity }),
    [knownPhone, knownCity]
  );

  function showForm() {
    setWhatsappNumber((current) => current || prefill.phone);
    setDeliveryCity((current) => current || prefill.city);
    setOpen(true);
    setOpenError("");
  }

  function updateProduct(id: string, patch: Partial<RequestProductDraft>) {
    setProducts((current) => current.map((product) => (product.id === id ? { ...product, ...patch } : product)));
  }

  function addProduct() {
    setProducts((current) =>
      current.length >= REQUEST_PRODUCT_LIMIT ? current : [...current, emptyRequestProduct(nextId())]
    );
  }

  function removeProduct(id: string) {
    setProducts((current) => (current.length <= 1 ? current : current.filter((product) => product.id !== id)));
  }

  function send() {
    setOpenError("");
    const result = validateRequestProducts({ products, whatsappNumber, deliveryCity, notes });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const url = buildRequestProductsWhatsAppUrl(
      requestProductsDestinationDigits(),
      formatRequestProductsMessage(result.value)
    );
    if (!url) {
      setErrors({ products: {} });
      setOpenError("WhatsApp is not available right now.");
      return;
    }
    setErrors({ products: {} });
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) setOpenError("WhatsApp could not be opened. Allow pop-ups and try again.");
  }

  return (
    <View className="mt-8 w-full rounded-2xl border border-border bg-card px-4 py-5">
      <Text className="text-center text-base font-extrabold text-ink">Can't find what you're looking for?</Text>
      <Text className="mt-1 text-center text-sm leading-5 text-muted">
        Tell us what you need and we'll help you find it.
      </Text>
      {open ? (
        <View className="mt-5">
          {products.map((product, index) => {
            const fieldErrors = errors.products[product.id];
            return (
              <View key={product.id} className="mb-4 rounded-2xl border border-border bg-surface px-3 py-3">
                <View className="flex-row items-center justify-between">
                  <Text className="text-sm font-extrabold text-ink">Product {index + 1}</Text>
                  {products.length > 1 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove product ${index + 1}`}
                      onPress={() => removeProduct(product.id)}
                      className="min-h-11 justify-center px-2"
                    >
                      <Text className="text-sm font-bold text-danger">Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text className="mt-2 text-sm font-semibold text-label">Product name</Text>
                <TextInput
                  value={product.name}
                  onChangeText={(name) => updateProduct(product.id, { name })}
                  accessibilityLabel={`Product ${index + 1} name`}
                  className="mt-1 min-h-11 rounded-xl border border-border bg-card px-3 py-3 text-base text-ink"
                />
                {fieldErrors?.name ? <Text className="mt-1 text-sm text-danger">{fieldErrors.name}</Text> : null}
                <Text className="mt-3 text-sm font-semibold text-label">Quantity</Text>
                <TextInput
                  value={product.quantity}
                  onChangeText={(quantity) => updateProduct(product.id, { quantity })}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  accessibilityLabel={`Product ${index + 1} quantity`}
                  className="mt-1 min-h-11 rounded-xl border border-border bg-card px-3 py-3 text-base text-ink"
                />
                {fieldErrors?.quantity ? (
                  <Text className="mt-1 text-sm text-danger">{fieldErrors.quantity}</Text>
                ) : null}
                <Text className="mt-3 text-sm font-semibold text-label">Additional details</Text>
                <TextInput
                  value={product.details}
                  onChangeText={(details) => updateProduct(product.id, { details })}
                  placeholder="Brand, color, size, model"
                  placeholderTextColor={DUTS.placeholder}
                  accessibilityLabel={`Product ${index + 1} details`}
                  className="mt-1 min-h-11 rounded-xl border border-border bg-card px-3 py-3 text-base text-ink"
                />
              </View>
            );
          })}
          {products.length < REQUEST_PRODUCT_LIMIT ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add another product"
              onPress={addProduct}
              className="min-h-11 items-center justify-center rounded-full border border-border bg-card px-4 py-3"
            >
              <Text className="text-sm font-extrabold text-ink">Add Another Product</Text>
            </Pressable>
          ) : null}
          <Text className="mt-5 text-sm font-semibold text-label">WhatsApp number</Text>
          <TextInput
            value={whatsappNumber}
            onChangeText={setWhatsappNumber}
            keyboardType="phone-pad"
            autoComplete="tel"
            accessibilityLabel="WhatsApp number"
            placeholder="+263…"
            placeholderTextColor={DUTS.placeholder}
            className="mt-1 min-h-11 rounded-xl border border-border bg-card px-3 py-3 text-base text-ink"
          />
          {errors.whatsappNumber ? <Text className="mt-1 text-sm text-danger">{errors.whatsappNumber}</Text> : null}
          <Text className="mt-3 text-sm font-semibold text-label">Delivery city</Text>
          <TextInput
            value={deliveryCity}
            onChangeText={setDeliveryCity}
            accessibilityLabel="Delivery city"
            className="mt-1 min-h-11 rounded-xl border border-border bg-card px-3 py-3 text-base text-ink"
          />
          {errors.deliveryCity ? <Text className="mt-1 text-sm text-danger">{errors.deliveryCity}</Text> : null}
          <Text className="mt-3 text-sm font-semibold text-label">Additional notes</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            multiline
            accessibilityLabel="Additional notes"
            className="mt-1 min-h-20 rounded-xl border border-border bg-card px-3 py-3 text-base text-ink"
          />
          {errors.form ? <Text className="mt-3 text-sm text-danger">{errors.form}</Text> : null}
          {openError ? <Text className="mt-3 text-sm text-danger">{openError}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send via WhatsApp"
            onPress={send}
            className="mt-5 min-h-11 items-center justify-center rounded-full bg-ink px-5 py-3"
          >
            <Text className="text-center text-sm font-extrabold text-white">Send via WhatsApp</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Request Products"
          onPress={showForm}
          className="mt-5 min-h-11 items-center justify-center self-center rounded-full bg-ink px-5 py-3"
        >
          <Text className="text-center text-sm font-extrabold text-white">Request Products</Text>
        </Pressable>
      )}
    </View>
  );
}
