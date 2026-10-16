import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, arrayUnion } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../Firebase/Config";

const FirestoreMethods = {
  // Add a new document to a collection
  async addDocument(collectionName, docId, data) {
    try {
      const docRef = doc(db, collectionName, docId);
      await setDoc(docRef, data);
      console.log(`${collectionName} document added successfully!`);
      return { success: true };
    } catch (error) {
      console.error(`Error adding document to ${collectionName}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // Retrieve a document by ID
  async getDocument(collectionName, docId) {
    try {
      const docRef = doc(db, collectionName, docId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        throw new Error("Document not found.");
      }

      return { success: true, data: docSnap.data() };
    } catch (error) {
      console.error(`Error retrieving document from ${collectionName}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // Update a document
  async updateDocument(collectionName, docId, updates) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, updates);
      console.log(`${collectionName} document updated successfully!`);
      return { success: true };
    } catch (error) {
      console.error(`Error updating document in ${collectionName}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // Delete a document
  async deleteDocument(collectionName, docId) {
    try {
      const docRef = doc(db, collectionName, docId);
      await deleteDoc(docRef);
      console.log(`${collectionName} document deleted successfully!`);
      return { success: true };
    } catch (error) {
      console.error(`Error deleting document from ${collectionName}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // Query documents with a condition
  async queryDocuments(collectionName, field, operator, value) {
    try {
      const q = query(collection(db, collectionName), where(field, operator, value));
      const querySnapshot = await getDocs(q);

      const results = [];
      querySnapshot.forEach((doc) => {
        results.push({ id: doc.id, ...doc.data() });
      });

      return { success: true, data: results };
    } catch (error) {
      console.error(`Error querying documents from ${collectionName}:`, error.message);
      return { success: false, error: error.message };
    }
  },

  // Upload a file to storage
  async uploadFile(filePath, file) {
    try {
      const fileRef = ref(storage, filePath);
      await uploadBytes(fileRef, file);
      const downloadURL = await getDownloadURL(fileRef);
      console.log(`File uploaded successfully! URL: ${downloadURL}`);
      return { success: true, url: downloadURL };
    } catch (error) {
      console.error("Error uploading file:", error.message);
      return { success: false, error: error.message };
    }
  },

  // Add a value to an array field
  async addToArrayField(collectionName, docId, arrayField, value) {
    try {
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        [arrayField]: arrayUnion(value),
      });
      console.log(`Value added to ${arrayField} in ${collectionName}!`);
      return { success: true };
    } catch (error) {
      console.error(`Error adding value to array field in ${collectionName}:`, error.message);
      return { success: false, error: error.message };
    }
  },
};

export default FirestoreMethods;
