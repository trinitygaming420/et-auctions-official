import { registerRootComponent } from "expo";
import { registerGlobals } from "@livekit/react-native";

// LiveKit must install its React Native browser/WebRTC globals before App.js
// imports any screen that uses livekit-client.
registerGlobals();

const App = require("./App").default;

registerRootComponent(App);
