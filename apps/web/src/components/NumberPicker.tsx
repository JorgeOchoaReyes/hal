"use client";

import { useEffect, useState } from "react";

interface HostedNumber {
  phoneNumber: string;
  label?: string;
  capabilities?: Array<"inbound" | "outbound">;
}

/**
 * A phone-number input that tries to pull the account's numbers from the
 * provider and offers them in a dropdown, while always allowing manual entry.
 *
 * - Provider supports listing + has numbers → dropdown of pulled numbers plus
 *   an "Enter manually…" option that reveals a text field.
 * - Provider can't list (or has none) → plain text field.
 *
 * So the app pulls numbers when it can, and the user handles it otherwise.
 */
export default function NumberPicker({
  accountId,
  ariaLabel,
  value,
  onChange,
  placeholder = "+14155550123 (target number)",
}: {
  accountId?: string;
  ariaLabel?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [numbers, setNumbers] = useState<HostedNumber[]>([]);
  const [supported, setSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    if (!accountId) {
      setNumbers([]);
      setSupported(false);
      return;
    }
    let cancelled = false;
    setNumbers([]);
    setSupported(false);
    setLoading(true);
    fetch(`/api/hosted-integrations/numbers?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((d: { supported?: boolean; numbers?: HostedNumber[] }) => {
        if (cancelled) return;
        const list = d.numbers ?? [];
        setNumbers(list);
        setSupported(Boolean(d.supported) && list.length > 0);
        // Default to manual when there's nothing to pick, or keep an existing value.
        setManual(list.length === 0);
      })
      .catch(() => {
        if (!cancelled) {
          setNumbers([]);
          setSupported(false);
          setManual(true);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // No pullable numbers → plain manual field.
  if (!supported || manual) {
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1, minWidth: 200 }}>
        <input
          aria-label={ariaLabel}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={loading ? "Loading numbers…" : placeholder}
          style={{ flex: 1 }}
        />
        {supported && numbers.length > 0 && (
          <button
            type="button"
            className="ghost"
            style={{ width: "auto", whiteSpace: "nowrap" }}
            onClick={() => setManual(false)}
          >
            Pick from account
          </button>
        )}
      </div>
    );
  }

  // Dropdown of pulled numbers + a manual-entry escape hatch.
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => {
        if (e.target.value === "__manual__") {
          setManual(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
      style={{ width: "auto", flex: 1, minWidth: 200 }}
    >
      <option value="">Select a number…</option>
      {value && !numbers.some((n) => n.phoneNumber === value) && (
        <option value={value}>{value} — manually entered</option>
      )}
      {numbers.map((n) => (
        <option key={n.phoneNumber} value={n.phoneNumber}>
          {n.phoneNumber}
          {n.label ? ` — ${n.label}` : ""}
        </option>
      ))}
      <option value="__manual__">Enter manually…</option>
    </select>
  );
}
