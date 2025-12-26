import React, { useMemo, useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useColorScheme } from "react-native";
import { useRouter } from "expo-router";
import { Colors } from "../../constants/theme";

const STORAGE_KEY = "PETFEED_DEVICES";

function isFiveDigits(value) {
  return /^[0-9]{5}$/.test((value || "").trim());
}

export default function ManualSetupScreen() {
  const scheme = useColorScheme() ?? "light";
  const colors = Colors[scheme];
  const router = useRouter();

  const [hostDigits, setHostDigits] = useState("");
  const [deviceName, setDeviceName] = useState("");

  const [hostnameModalOpen, setHostnameModalOpen] = useState(false);
  const [nameModalOpen, setNameModalOpen] = useState(false);

  const [hostnameExists, setHostnameExists] = useState(false);

  const canContinueHostname = useMemo(() => isFiveDigits(hostDigits), [hostDigits]);

  const fullHostname = useMemo(() => {
    const digits = (hostDigits || "").trim();
    return isFiveDigits(digits) ? `petfeeder-${digits}.local` : "";
  }, [hostDigits]);

  useEffect(() => {
    (async () => {
      if (!fullHostname) {
        setHostnameExists(false);
        return;
      }

      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const list = raw ? JSON.parse(raw) : [];

      const baseHost = fullHostname.replace(".local", "");

      const exists = Array.isArray(list)
        ? list.some((d) => d.host === baseHost)
        : false;

      setHostnameExists(exists);
    })();
  }, [fullHostname]);

  async function saveDevice({ name, hostname }) {
    const baseHost = hostname.replace(".local", "");
    const manualId = `manual_${baseHost}`;

    const newDevice = {
      id: manualId,
      name,
      host: baseHost,
      hostname,
      mode: "wifi",
      online: false,
      createdAt: new Date().toISOString(),
    };

    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? [...list, newDevice] : [newDevice];

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  async function finishSetup() {
    try {
      const name = (deviceName || "").trim();
      if (!name) {
        Alert.alert("Name required", "Please enter a device name.");
        return;
      }
      const hostname = fullHostname.trim();
      if (!hostname) {
        Alert.alert("Invalid hostname", "Please enter the 5 digits from the hostname.");
        return;
      }

      await saveDevice({ name, hostname });

      // Go back to the Devices tab
      router.replace("/devices");
    } catch (e) {
      Alert.alert("Setup failed", "Could not save the device. Please try again.");
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.text }]}>Add existing device</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Use this if the feeder is already set up on Wi-Fi and connected to someone else’s phone.
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={[styles.instructionsLabel, { color: colors.textSecondary }]}>
          Instructions
        </Text>

        <View style={styles.steps}>
          <Text style={[styles.step, { color: colors.textSecondary }]}>
            1. Get the phone that is already connected to the feeder.
          </Text>
          <Text style={[styles.step, { color: colors.textSecondary }]}>
            2. Open the app on that phone, go to the Devices screen, tap the gear icon on the
            feeder, then tap Device details.
          </Text>
          <Text style={[styles.step, { color: colors.textSecondary }]}>
            3. Copy the HOSTNAME (example: petfeeder-48291.local).
          </Text>
          <Text style={[styles.step, { color: colors.textSecondary }]}>
            4. On this phone, press Begin setup below and enter the 5 digits from the hostname.
          </Text>
        </View>

        <Pressable
          onPress={() => {
            setHostDigits("");
            setDeviceName("");
            setHostnameModalOpen(true);
          }}
          style={[
            styles.primaryBtn,
            {
              backgroundColor:
                scheme === "dark"
                  ? "#1f6feb"
                  : "#2563eb",
              shadowColor: "#000",
              shadowOpacity: scheme === "dark" ? 0.4 : 0.25,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 6 },
              elevation: 6,
            },
          ]}
        >
          <Text style={[styles.primaryBtnText, { color: "#ffffff" }]}>Begin setup</Text>
        </Pressable>
      </View>

      {/* Hostname modal */}
      <Modal
        visible={hostnameModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setHostnameModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[
              styles.modalCenter,
              {
                justifyContent: "flex-start",
                marginTop: "12%",
              },
            ]}
          >
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: scheme === "dark" ? "#0f172a" : "#ffffff",
                },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>Enter hostname</Text>
              <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
                Enter the 5 digits from the hostname.
              </Text>

              <View style={styles.hostnameRow}>
                <Text style={[styles.hostnameAffix, { color: colors.textSecondary }]}>
                  petfeeder-
                </Text>
                <TextInput
                  value={hostDigits}
                  onChangeText={(t) => setHostDigits((t || "").replace(/[^0-9]/g, "").slice(0, 5))}
                  keyboardType="number-pad"
                  placeholder="12345"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.hostnameInput,
                    {
                      color: colors.text,
                      borderColor: colors.textSecondary + "55",
                      backgroundColor: scheme === "dark" ? "#0b1220" : "#ffffffcc",
                    },
                  ]}
                  maxLength={5}
                  autoFocus
                />
                <Text style={[styles.hostnameAffix, { color: colors.textSecondary }]}>.local</Text>
              </View>

              {hostnameExists && (
                <Text style={{ color: "#dc2626", fontSize: 13, marginTop: 6 }}>
                  This device is already added to your app.
                </Text>
              )}

              {!!fullHostname && (
                <Text style={[styles.previewText, { color: colors.textSecondary }]}>
                  Will use: {fullHostname}
                </Text>
              )}

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setHostnameModalOpen(false)}
                  style={[styles.modalBtn, { borderColor: colors.textSecondary + "55" }]}
                >
                  <Text style={[styles.modalBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </Pressable>

                <Pressable
                  disabled={!canContinueHostname || hostnameExists}
                  onPress={() => {
                    setHostnameModalOpen(false);
                    setNameModalOpen(true);
                  }}
                  style={[
                    styles.modalBtnPrimary,
                    {
                      backgroundColor:
                        !canContinueHostname || hostnameExists
                          ? (scheme === "dark" ? "#1f2937" : "#cbd5e1")
                          : (scheme === "dark" ? "#1f6feb" : "#2563eb"),
                      opacity: canContinueHostname && !hostnameExists ? 1 : 0.4,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 15, fontWeight: "800", color: "#ffffff" }}>
                    Continue
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Name modal */}
      <Modal
        visible={nameModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNameModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={[
              styles.modalCenter,
              {
                justifyContent: "flex-start",
                marginTop: "12%",
              },
            ]}
          >
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: scheme === "dark" ? "#0f172a" : "#ffffff",
                },
              ]}
            >
              <Text style={[styles.modalTitle, { color: colors.text }]}>Name this device</Text>
              <Text style={[styles.modalHint, { color: colors.textSecondary }]}>
                Choose a name you’ll recognise on your Devices screen.
              </Text>

              <TextInput
                value={deviceName}
                onChangeText={setDeviceName}
                placeholder="e.g. Kitchen feeder"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.nameInput,
                  {
                    color: colors.text,
                    borderColor: colors.textSecondary + "55",
                    backgroundColor: scheme === "dark" ? "#0b1220" : "#ffffffcc",
                  },
                ]}
                autoFocus
              />

              <View style={styles.modalActions}>
                <Pressable
                  onPress={() => setNameModalOpen(false)}
                  style={[styles.modalBtn, { borderColor: colors.textSecondary + "55" }]}
                >
                  <Text style={[styles.modalBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={finishSetup}
                  style={[
                    styles.modalBtnPrimary,
                    {
                      backgroundColor:
                        scheme === "dark"
                          ? "#1f6feb"
                          : "#2563eb",
                      opacity: deviceName.trim() ? 1 : 0.4,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 15, fontWeight: "800", color: "#ffffff" }}>
                    Save
                  </Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 18 },
  header: { gap: 8, marginBottom: 16, /* understanding: undefined */ },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 14, lineHeight: 20 },

  card: {
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },

  instructionsLabel: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  steps: { gap: 8 },
  step: { fontSize: 14, lineHeight: 20 },

  primaryBtn: {
    marginTop: 6,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.9)",
    justifyContent: "flex-start",
    paddingTop: "50%",
    paddingHorizontal: 18,
  },
  modalCenter: { width: "100%" },
  modalCard: {
    borderRadius: 20,
    padding: 20,
    gap: 14,
    backgroundColor: "#0f172a",
  },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalHint: { fontSize: 13, lineHeight: 18 },

  hostnameRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  hostnameAffix: { fontSize: 14, fontWeight: "600" },
  hostnameInput: {
    minWidth: 90,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
  },
  previewText: { fontSize: 12 },

  nameInput: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 6,
  },

  modalActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  modalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  modalBtnText: { fontSize: 14, fontWeight: "700" },

  modalBtnPrimary: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnPrimaryText: { fontSize: 14, fontWeight: "800" },
});