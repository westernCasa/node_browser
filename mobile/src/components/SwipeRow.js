// A row that can be swiped left to remove it (as in iOS Mail and Safari's tab
// list). Short swipes spring back. Taps still go to the row's own Pressable.
import { useRef } from "react";
import { Animated, PanResponder, Text, View } from "react-native";
import { colors } from "../theme";

const CLOSE_AT = -90;

export default function SwipeRow({ onSwipe, label = "Close", children }) {
  const x = useRef(new Animated.Value(0)).current;
  const pan = useRef(
    PanResponder.create({
      // Only clearly sideways moves start a swipe; vertical moves scroll the list.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderMove: (_e, g) => x.setValue(Math.min(0, g.dx)),
      onPanResponderRelease: (_e, g) => {
        if (g.dx < CLOSE_AT || g.vx < -0.8) {
          Animated.timing(x, { toValue: -500, duration: 160, useNativeDriver: true }).start(() => onSwipe());
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: true }).start();
        }
      },
      onPanResponderTerminate: () => Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(),
    })
  ).current;
  return (
    <View style={{ overflow: "hidden" }}>
      <View style={{ position: "absolute", top: 0, bottom: 0, right: 0, left: 0, backgroundColor: colors.bad, alignItems: "flex-end", justifyContent: "center", paddingRight: 16 }}>
        <Text style={{ color: "#000", fontWeight: "600" }}>{label}</Text>
      </View>
      <Animated.View style={{ transform: [{ translateX: x }], backgroundColor: colors.bg2 }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}
