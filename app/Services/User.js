import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../Firebase/Config";

function profileFromSnapshot(firebaseUser, snapshot, name) {
  const savedProfile = snapshot?.exists() ? snapshot.data() : {};
  const now = new Date().toISOString();
  const profileName =
    name ||
    savedProfile.nom ||
    savedProfile.name ||
    firebaseUser.displayName ||
    firebaseUser.email?.split("@")[0] ||
    "Utilisateur";
  const profile = {
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    email: firebaseUser.email ?? "",
    name: profileName,
    nom: profileName,
    role: savedProfile.role || "user",
    profilePic: savedProfile.profilePic || firebaseUser.photoURL || "",
    createdAt: savedProfile.createdAt || now,
    updatedAt: now,
  };

  return profile;
}

class User {
  constructor(email, password, profile = {}) {
    this.email = email;
    this.password = password;
    this.profile = profile;
  }

  async signup() {
    const credentials = await createUserWithEmailAndPassword(
      auth,
      this.email,
      this.password,
    );
    return User.saveProfile(credentials.user, this.profile);
  }

  async login() {
    return signInWithEmailAndPassword(
      auth,
      this.email,
      this.password,
    );
  }

  static async getProfile(firebaseUser) {
    const profileRef = doc(db, "users", firebaseUser.uid);
    const snapshot = await getDoc(profileRef);
    const profile = profileFromSnapshot(firebaseUser, snapshot);

    if (!snapshot.exists()) {
      await setDoc(profileRef, profile);
    }

    return profile;
  }

  static async saveProfile(firebaseUser, details = {}) {
    const profileRef = doc(db, "users", firebaseUser.uid);
    const profile = profileFromSnapshot(firebaseUser, null, details.name);
    const savedProfile = {
      ...profile,
      profilePic: details.profilePic || profile.profilePic,
    };

    await setDoc(profileRef, savedProfile, { merge: true });
    return savedProfile;
  }
}

export default User;
