// Settings → Sync on the phone (B50): scan the QR code NODE shows on a
// computer (Settings → Sync → Pair a device…), or paste the code; then the
// paired devices, Sync now and Stop syncing. src/sync.js does the work.
import { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { colors, ui } from "../theme";
import Button from "./Button";

const ago = (t) => {
  if (!t) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

function stateText(info) {
  if (!info.paired) return info.state === "unpaired" ? info.message : "Off. Your trails stay on this phone.";
  if (info.state === "ok") return `On · synced ${ago(info.at)}${info.pending ? ` · ${info.pending} changes waiting` : ""}`;
  if (info.state === "offline" || info.state === "error" || info.state === "unpaired") return `On · ${info.message}`;
  return "On · syncing…";
}

function Scanner({ onCode, onCancel }) {
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);
  if (!permission) return null; // still loading
  if (!permission.granted) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={ui.help}>NODE needs the camera to read the code. It is used only while this scanner is open.</Text>
        <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
          {permission.canAskAgain ? <Button label="Allow camera" small active onPress={requestPermission} /> : <Text style={ui.help}>Turn on the camera for NODE in the phone's Settings, or paste the code below.</Text>}
          <Button label="Cancel" small onPress={onCancel} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ height: 260, borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: colors.line }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (done.current || !/^NODE-SYNC1:/.test(String(data))) return;
            done.current = true;
            onCode(String(data));
          }}
          accessibilityLabel="Camera, pointing at the pairing code"
        />
      </View>
      <Text style={[ui.help, { marginTop: 6 }]}>Point the camera at the code on your computer.</Text>
      <View style={{ flexDirection: "row", marginTop: 6 }}>
        <Button label="Cancel" small onPress={onCancel} />
      </View>
    </View>
  );
}

export default function SyncSettings({ sync }) {
  const [info, setInfo] = useState(() => sync.info());
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false);
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [name, setName] = useState(() => sync.info().device?.name || "");
  useEffect(() => sync.on((_e, i) => setInfo(i)), [sync]);
  // "Syncing…": at once after Sync now; for background rounds only past
  // 400 ms, so the line doesn't flicker every 10 s.
  const [manual, setManual] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!info.busy) {
      setSlow(false);
      setManual(false);
      return undefined;
    }
    const t = setTimeout(() => setSlow(true), 400);
    return () => clearTimeout(t);
  }, [info.busy]);
  const syncing = info.paired && info.busy && (manual || slow);

  const pair = async (text) => {
    setScanning(false);
    setMsg("Pairing…");
    const r = await sync.pair(text);
    setInfo(sync.info());
    if (!r.ok) return setMsg(r.error || "Pairing didn't work. Try again.");
    setTyping(false);
    setCode("");
    const others = r.info.peers.map((p) => p.name);
    setMsg(others.length ? `Paired with ${others.join(" and ")}. Trails now sync both ways.` : "Paired. Trails sync once the computer is online.");
  };

  return (
    <View>
      <Text style={ui.kicker} accessibilityRole="header">
        Sync
      </Text>
      <Text style={[ui.help, { color: info.state === "ok" ? colors.ok : info.state === "unpaired" || info.state === "error" ? colors.bad : colors.mute }]}>{syncing ? "On · syncing…" : stateText(info)}</Text>
      <Text style={[ui.help, { marginTop: 4 }]}>
        Sync your trails with NODE on your computer. Pair once with the QR code; no account. Trails are encrypted on your devices before they are sent, so the sync server can't read them, and it deletes them once your other devices have them (30 days at most). Screenshots and audio stay on the device that made them.
      </Text>
      {!info.paired ? (
        <>
          <Text style={[ui.help, { marginTop: 6 }]}>On your computer: Settings → Sync → Pair a device…</Text>
          {scanning ? <Scanner onCode={pair} onCancel={() => setScanning(false)} /> : null}
          {typing ? (
            <View style={{ marginTop: 6 }}>
              <TextInput style={ui.input} value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} placeholder="NODE-SYNC1:…" placeholderTextColor={colors.mute} accessibilityLabel="Code from your computer" />
              <View style={{ flexDirection: "row", gap: 6, marginTop: 6 }}>
                <Button label="Pair" small active onPress={() => pair(code)} />
                <Button label="Cancel" small onPress={() => setTyping(false)} />
              </View>
            </View>
          ) : null}
          {!scanning && !typing ? (
            <View style={{ flexDirection: "row", gap: 6, marginTop: 8 }}>
              <Button label="Scan code" small active onPress={() => (setMsg(""), setScanning(true))} />
              <Button label="Enter a code" small onPress={() => (setMsg(""), setTyping(true))} />
            </View>
          ) : null}
        </>
      ) : (
        <>
          <View style={{ marginTop: 6 }}>
            <Text style={[ui.help, { marginBottom: 2 }]}>This phone's name on your other devices</Text>
            <TextInput style={ui.input} value={name} onChangeText={setName} onEndEditing={() => setInfo(sync.rename(name))} maxLength={60} autoCorrect={false} accessibilityLabel="This phone's name" />
          </View>
          {info.peers.map((p) => (
            <View key={p.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: 6, marginTop: 6 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text }}>{p.name}</Text>
                <Text style={ui.help}>{`${p.kind === "phone" ? "Phone" : "Computer"} · last synced ${ago(p.at)}`}</Text>
              </View>
              <Button label="Remove" small onPress={async () => setInfo(await sync.removeDevice(p.id))} />
            </View>
          ))}
          {!info.peers.length ? <Text style={[ui.help, { marginTop: 6 }]}>No other device yet. Waiting for your computer to sync.</Text> : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            <Button label={syncing ? "Syncing…" : "Sync now"} small disabled={syncing} onPress={async () => (setManual(true), setInfo(await sync.now()))} />
            <Button label="Stop syncing on this phone" small onPress={async () => (setInfo(await sync.stop()), setMsg("This phone no longer syncs. Its trails stay here, and your other devices keep theirs."))} />
          </View>
        </>
      )}
      {msg ? <Text style={[ui.help, { marginTop: 6 }]}>{msg}</Text> : null}
    </View>
  );
}
