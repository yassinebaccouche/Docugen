import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBHbySP9vOhI8xvN_kLHyJCsBtAI1h19Fk",
  authDomain: "docugen-2cf91.firebaseapp.com",
  projectId: "docugen-2cf91",
  storageBucket: "docugen-2cf91.firebasestorage.app",
  messagingSenderId: "294530320992",
  appId: "1:294530320992:web:8263b8c98ade0b22091105",
  measurementId: "G-549WGSJGQS",
};

const existingApps = getApps();
const app = existingApps.length
  ? existingApps[0]
  : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;