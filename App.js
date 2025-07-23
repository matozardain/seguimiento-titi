import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, getDoc } from 'firebase/firestore';

// Define Firebase configuration and app ID from global variables
// These variables are provided by the Canvas environment.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Initialize Firebase app
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Initial medication data (will be used to populate Firestore if empty)
const defaultMedications = [
  { id: 't4', name: 'T4', dosage: '', time: 'Ayunas', frequency: 'Diario' },
  { id: 'levecom-m', name: 'Levecom', dosage: '500mg', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'deslefex', name: 'Deslefex', dosage: '', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'lukast', name: 'Lukast', dosage: '', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'hidrotisona-m', name: 'Hidrotisona', dosage: '10mg', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'velsarten', name: 'Velsarten', dosage: '160mg', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'amlodipino', name: 'Amlodipino', dosage: '1/2 5mg', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'dexlansoprazol', name: 'Dexlansoprazol', dosage: '', time: 'Mañana Post desayuno', frequency: 'Diario' },
  { id: 'hidrotisona-ac', name: 'Hidrotisona', dosage: '', time: 'Antes de Comer 13hs', frequency: 'Diario' },
  { id: 'b12', name: 'B12', dosage: '3 veces x semana sublingual', time: 'Antes de Comer 13hs', frequency: 'Martes, Jueves, Sábados' },
  { id: 'hidrotisona-t', name: 'Hidrotisona', dosage: '1/2 5mg', time: 'Tarde 18hs', frequency: 'Diario' },
  { id: 'levecom-n', name: 'Levecom', dosage: '', time: 'Noche', frequency: 'Diario' },
  { id: 'novo-insomnum', name: 'Novo Insomnum', dosage: '', time: 'Noche', frequency: 'Diario' },
  { id: 'roovex', name: 'Reorex', dosage: '10mg', time: 'Noche', frequency: 'Diario' },
  { id: 'vitamina-d', name: 'Vitamina D (Firesole/Apolar)', dosage: '1 vez al mes', time: 'Mensual', frequency: 'Último Martes del Mes' },
  { id: 'miopropan', name: 'Mipropan', dosage: '', time: 'Según necesidad', frequency: 'En caso de diarrea' },
  { id: 'naproxeno', name: 'Naproxeno', dosage: '', time: 'Según necesidad', frequency: 'En caso de dolor de cabeza' },
];

// Helper function to format date for Firestore document IDs (YYYY-MM-DD)
const formatDateForFirestore = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper function to get the last Tuesday of a given month/year
const getLastTuesdayOfMonth = (year, month) => {
  const lastDayOfMonth = new Date(year, month + 1, 0); // Last day of the current month
  let lastTuesday = new Date(lastDayOfMonth);

  // Iterate backwards from the last day to find the last Tuesday
  while (lastTuesday.getDay() !== 2) { // 2 = Tuesday
    lastTuesday.setDate(lastTuesday.getDate() - 1);
  }
  return lastTuesday;
};

// Main App component
function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [medicationStatus, setMedicationStatus] = useState({});
  const [notes, setNotes] = useState([]);
  const [bloodPressure, setBloodPressure] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userName, setUserName] = useState('');
  const [showNameInput, setShowNameInput] = useState(false);
  const [showShareMessage, setShowShareMessage] = useState(false);
  const [medicationDefinitions, setMedicationDefinitions] = useState([]);
  const [showManageMedications, setShowManageMedications] = useState(false);
  const [newMedication, setNewMedication] = useState({ id: '', name: '', dosage: '', time: '', frequency: '' });
  const [editMedicationId, setEditMedicationId] = useState(null);

  const noteInputRef = useRef(null);
  const systolicRef = useRef(null);
  const diastolicRef = useRef(null);
  const newMedNameRef = useRef(null);

  // 1. Authenticate anonymously and set auth readiness
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log("Firebase Auth Ready. User:", user.uid);
        setIsAuthReady(true);
      } else {
        console.log("No user found, signing in anonymously...");
        signInAnonymously(auth).catch(error => {
          console.error("Error signing in anonymously:", error);
          setIsAuthReady(false); // Indicate auth is not ready
          setLoading(false); // Stop loading if auth fails
        });
      }
    });
    return () => unsubscribe(); // Cleanup auth listener
  }, []);

  // 2. Load user name from localStorage
  useEffect(() => {
    const storedName = localStorage.getItem('medication_calendar_user_name');
    if (storedName) {
      setUserName(storedName);
    } else {
      setShowNameInput(true); // Show input if no name stored
    }
  }, []);

  // 3. Fetch medication definitions from Firestore or populate if empty
  useEffect(() => {
    if (!isAuthReady) return;

    const medDefinitionsDocRef = doc(db, `artifacts/${appId}/public/data/medicationDefinitions`, 'currentDefinitions');

    const fetchDefinitions = async () => {
      try {
        const docSnap = await getDoc(medDefinitionsDocRef);
        if (docSnap.exists()) {
          setMedicationDefinitions(docSnap.data().medications);
        } else {
          // If no definitions exist, populate with default ones
          await setDoc(medDefinitionsDocRef, { medications: defaultMedications });
          setMedicationDefinitions(defaultMedications);
        }
      } catch (error) {
        console.error("Error fetching or setting medication definitions:", error);
      }
    };

    fetchDefinitions();
  }, [isAuthReady]);

  // 4. Listen for daily records (medication status, notes, BP) from Firestore
  useEffect(() => {
    if (!isAuthReady) return;

    const formattedDate = formatDateForFirestore(currentDate);
    const dailyRecordDocRef = doc(db, `artifacts/${appId}/public/data/dailyRecords`, formattedDate);

    console.log("Setting up Firestore listener for daily records:", formattedDate);
    const unsubscribe = onSnapshot(dailyRecordDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setMedicationStatus(JSON.parse(data.medicationStatus || '{}'));
        setNotes(JSON.parse(data.notes || '[]'));
        setBloodPressure(JSON.parse(data.bloodPressure || '[]'));
        console.log("Daily records loaded:", data);
      } else {
        setMedicationStatus({});
        setNotes([]);
        setBloodPressure([]);
        console.log("No daily records found for this date.");
      }
      setLoading(false); // Data loaded, stop loading indicator
    }, (error) => {
      console.error("Error fetching daily records:", error);
      setLoading(false); // Stop loading even on error
    });

    return () => {
      console.log("Cleaning up Firestore listener for daily records.");
      unsubscribe(); // Cleanup Firestore listener
    }
  }, [currentDate, isAuthReady]);

  // Save user name
  const handleSaveUserName = () => {
    if (userName.trim()) {
      localStorage.setItem('medication_calendar_user_name', userName.trim());
      setShowNameInput(false);
    }
  };

  // Update Firestore document for medication status
  const updateDailyRecord = async (field, value) => {
    if (!isAuthReady) {
      console.error("Authentication not ready. Cannot save data.");
      return;
    }
    const formattedDate = formatDateForFirestore(currentDate);
    const dailyRecordDocRef = doc(db, `artifacts/${appId}/public/data/dailyRecords`, formattedDate);

    try {
      await setDoc(dailyRecordDocRef, { [field]: JSON.stringify(value), date: formattedDate }, { merge: true });
    } catch (e) {
      console.error(`Error updating ${field} in document: `, e);
    }
  };

  // Handle medication checkbox toggle
  const handleToggleMedication = (medId) => {
    const newStatus = {
      ...medicationStatus,
      [medId]: !medicationStatus[medId],
    };
    setMedicationStatus(newStatus); // Optimistic update
    updateDailyRecord('medicationStatus', newStatus);
  };

  // Handle adding a new note
  const handleAddNote = () => {
    const noteText = noteInputRef.current.value.trim();
    if (noteText && userName) {
      const newNotes = [...notes, {
        text: noteText,
        author: userName,
        timestamp: new Date().toISOString()
      }];
      setNotes(newNotes); // Optimistic update
      updateDailyRecord('notes', newNotes);
      noteInputRef.current.value = ''; // Clear input
    } else if (!userName) {
      alert("Por favor, ingresa tu nombre para añadir una nota.");
      setShowNameInput(true);
    }
  };

  // Handle adding a new blood pressure reading
  const handleAddBloodPressure = () => {
    const systolic = systolicRef.current.value.trim();
    const diastolic = diastolicRef.current.value.trim();
    if (systolic && diastolic && userName) {
      const newBP = [...bloodPressure, {
        systolic: systolic,
        diastolic: diastolic,
        author: userName,
        timestamp: new Date().toISOString()
      }];
      setBloodPressure(newBP); // Optimistic update
      updateDailyRecord('bloodPressure', newBP);
      systolicRef.current.value = ''; // Clear inputs
      diastolicRef.current.value = '';
    } else if (!userName) {
      alert("Por favor, ingresa tu nombre para registrar la presión.");
      setShowNameInput(true);
    }
  };

  // Navigate to previous day
  const goToPreviousDay = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() - 1);
    setCurrentDate(newDate);
  };

  // Navigate to next day
  const goToNextDay = () => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + 1);
    setCurrentDate(newDate);
  };

  // Share via WhatsApp
  const shareViaWhatsApp = () => {
    const appUrl = window.location.href;
    const message = `¡Hola! Aquí tienes el enlace al calendario de medicamentos de mamá para que puedas verlo y actualizarlo: ${appUrl}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, '_blank');
    setShowShareMessage(true);
    setTimeout(() => setShowShareMessage(false), 5000); // Hide message after 5 seconds
  };

  // Filter medications for display based on frequency
  const getFilteredMedications = () => {
    const currentDayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const currentDay = currentDate.getDate();

    return medicationDefinitions.filter(med => {
      switch (med.frequency) {
        case 'Diario':
          return true;
        case 'Martes, Jueves, Sábados':
          return currentDayOfWeek === 2 || currentDayOfWeek === 4 || currentDayOfWeek === 6;
        case 'Último Martes del Mes':
          const lastTuesday = getLastTuesdayOfMonth(currentYear, currentMonth);
          return currentDate.toDateString() === lastTuesday.toDateString();
        case 'Según necesidad': // These are special notes, not daily meds
          return false;
        default:
          return true;
      }
    });
  };

  const medicationsToDisplay = getFilteredMedications();

  // Group medications by time for display
  const groupedMedications = medicationsToDisplay.reduce((acc, med) => {
    if (!acc[med.time]) {
      acc[med.time] = [];
    }
    acc[med.time].push(med);
    return acc;
  }, {});

  // --- Medication Management Functions ---
  const handleAddEditMedication = async () => {
    if (!newMedication.name || !newMedication.time || !newMedication.frequency) {
      alert("Nombre, horario y frecuencia son campos obligatorios.");
      return;
    }

    const medDefinitionsDocRef = doc(db, `artifacts/${appId}/public/data/medicationDefinitions`, 'currentDefinitions');
    let updatedMedications;

    if (editMedicationId) {
      // Edit existing medication
      updatedMedications = medicationDefinitions.map(med =>
        med.id === editMedicationId ? { ...newMedication, id: editMedicationId } : med
      );
    } else {
      // Add new medication
      updatedMedications = [...medicationDefinitions, { ...newMedication, id: Date.now().toString() }];
    }

    try {
      await setDoc(medDefinitionsDocRef, { medications: updatedMedications });
      setMedicationDefinitions(updatedMedications);
      setNewMedication({ id: '', name: '', dosage: '', time: '', frequency: '' });
      setEditMedicationId(null);
      setShowManageMedications(false); // Close modal after saving
    } catch (error) {
      console.error("Error saving medication definitions:", error);
      alert("Error al guardar los medicamentos. Inténtalo de nuevo.");
    }
  };

  const handleEditClick = (med) => {
    setNewMedication(med);
    setEditMedicationId(med.id);
    setShowManageMedications(true);
  };

  const handleDeleteMedication = async (medId) => {
    if (window.confirm("¿Estás seguro de que quieres eliminar este medicamento?")) {
      const medDefinitionsDocRef = doc(db, `artifacts/${appId}/public/data/medicationDefinitions`, 'currentDefinitions');
      const updatedMedications = medicationDefinitions.filter(med => med.id !== medId);

      try {
        await setDoc(medDefinitionsDocRef, { medications: updatedMedications });
        setMedicationDefinitions(updatedMedications);
      } catch (error) {
        console.error("Error deleting medication:", error);
        alert("Error al eliminar el medicamento. Inténtalo de nuevo.");
      }
    }
  };

  if (loading || !isAuthReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
        <div className="text-lg font-semibold">Cargando calendario...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-inter p-4 sm:p-6 lg:p-8 flex flex-col items-center">
      <div className="w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 sm:p-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-6 text-indigo-700 dark:text-indigo-400">
          Calendario de Medicamentos de Mamá
        </h1>

        {/* User Name Input Modal */}
        {showNameInput && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-700 p-6 rounded-lg shadow-xl w-80">
              <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-gray-100">¿Quién eres?</h3>
              <input
                type="text"
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md mb-4 bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                placeholder="Tu nombre o apodo (ej. Ana, Juan)"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                autoFocus
              />
              <button
                onClick={handleSaveUserName}
                className="w-full px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg shadow-md transition-transform transform hover:scale-105"
              >
                Guardar
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-between items-center mb-6">
          <button
            onClick={goToPreviousDay}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg shadow-md transition-transform transform hover:scale-105"
          >
            Día Anterior
          </button>
          <h2 className="text-xl sm:text-2xl font-semibold text-center">
            {currentDate.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </h2>
          <button
            onClick={goToNextDay}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg shadow-md transition-transform transform hover:scale-105"
          >
            Día Siguiente
          </button>
        </div>

        {/* Current User Display */}
        {userName && (
          <div className="mb-6 p-3 bg-blue-100 dark:bg-blue-900 rounded-lg text-blue-800 dark:text-blue-200 text-center">
            <p className="text-sm sm:text-base">
              Estás usando la app como: <span className="font-bold">{userName}</span>
              <button
                onClick={() => setShowNameInput(true)}
                className="ml-2 text-indigo-600 dark:text-indigo-400 hover:underline text-sm"
              >
                Cambiar
              </button>
            </p>
          </div>
        )}

        {/* Additional Notes Section */}
        <div className="mb-6 p-4 bg-yellow-100 dark:bg-yellow-900 rounded-lg text-yellow-800 dark:text-yellow-200">
          <h3 className="text-xl font-bold mb-2 text-yellow-900 dark:text-yellow-100">Notas y Consideraciones Especiales:</h3>
          <ul className="list-disc list-inside text-sm sm:text-base">
            <li>Tomar la presión 2 veces por semana y anotarlo.</li>
            <li>En caso de diarrea, suministrar Miopropan.</li>
            <li>En caso de dolor de cabeza, suministrar Naproxeno.</li>
            <li>Avisar a la familia en caso de: Diarrea, fiebre, infección.</li>
          </ul>
        </div>

        {/* Medication List */}
        {Object.keys(groupedMedications).sort((a, b) => {
          // Custom sort order for medication times
          const order = ['Ayunas', 'Mañana Post desayuno', 'Antes de Comer 13hs', 'Tarde 18hs', 'Noche', 'Mensual'];
          return order.indexOf(a) - order.indexOf(b);
        }).map((time) => (
          <div key={time} className="mb-6">
            <h3 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200 border-b-2 border-indigo-300 dark:border-indigo-700 pb-2">
              {time}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {groupedMedications[time].map((med) => (
                <div
                  key={med.id}
                  className={`flex items-center p-4 rounded-lg shadow-sm transition-all duration-200
                    ${medicationStatus[med.id] ? 'bg-green-100 dark:bg-green-700 border-l-4 border-green-500' : 'bg-gray-50 dark:bg-gray-700 border-l-4 border-gray-300 dark:border-gray-600'}`}
                >
                  <input
                    type="checkbox"
                    id={med.id}
                    checked={!!medicationStatus[med.id]}
                    onChange={() => handleToggleMedication(med.id)}
                    className="form-checkbox h-6 w-6 text-indigo-600 rounded-md transition-colors duration-200 mr-4 cursor-pointer"
                  />
                  <label htmlFor={med.id} className="flex-1 text-lg font-medium cursor-pointer">
                    {med.name} {med.dosage && <span className="text-gray-600 dark:text-gray-300 text-base">({med.dosage})</span>}
                  </label>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Blood Pressure Section */}
        <div className="mb-6 p-4 bg-purple-100 dark:bg-purple-900 rounded-lg text-purple-800 dark:text-purple-200">
          <h3 className="text-xl font-bold mb-4 text-purple-900 dark:text-purple-100 border-b-2 border-purple-300 dark:border-purple-700 pb-2">
            Registro de Presión Arterial
          </h3>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <input
              type="number"
              ref={systolicRef}
              className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
              placeholder="Sistólica (ej. 120)"
            />
            <input
              type="number"
              ref={diastolicRef}
              className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
              placeholder="Diastólica (ej. 80)"
            />
            <button
              onClick={handleAddBloodPressure}
              className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg shadow-md transition-transform transform hover:scale-105"
            >
              Registrar Presión
            </button>
          </div>
          {bloodPressure.length > 0 && (
            <div className="mt-4 max-h-40 overflow-y-auto">
              <h4 className="font-semibold mb-2">Registros del día:</h4>
              <ul className="space-y-2">
                {bloodPressure.map((bp, index) => (
                  <li key={index} className="p-2 bg-purple-50 dark:bg-purple-800 rounded-md text-sm">
                    <span className="font-bold">{bp.systolic}/{bp.diastolic} mmHg</span> -{' '}
                    {new Date(bp.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} por{' '}
                    <span className="font-medium">{bp.author}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Notes Section */}
        <div className="mb-6 p-4 bg-teal-100 dark:bg-teal-900 rounded-lg text-teal-800 dark:text-teal-200">
          <h3 className="text-xl font-bold mb-4 text-teal-900 dark:text-teal-100 border-b-2 border-teal-300 dark:border-teal-700 pb-2">
            Notas del Día
          </h3>
          <textarea
            ref={noteInputRef}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md mb-4 h-24 bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
            placeholder="Escribe aquí cualquier nota adicional..."
          ></textarea>
          <button
            onClick={handleAddNote}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-lg shadow-md transition-transform transform hover:scale-105"
          >
            Añadir Nota
          </button>
          {notes.length > 0 && (
            <div className="mt-4 max-h-40 overflow-y-auto">
              <h4 className="font-semibold mb-2">Notas registradas:</h4>
              <ul className="space-y-2">
                {notes.map((note, index) => (
                  <li key={index} className="p-2 bg-teal-50 dark:bg-teal-800 rounded-md text-sm">
                    "{note.text}" -{' '}
                    {new Date(note.timestamp).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} por{' '}
                    <span className="font-medium">{note.author}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Manage Medications Button */}
        <div className="mt-8 text-center">
          <button
            onClick={() => setShowManageMedications(true)}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xl transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 mr-4"
          >
            Administrar Medicamentos
          </button>
          <button
            onClick={shareViaWhatsApp}
            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-lg shadow-xl transition-transform transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75"
          >
            Compartir por WhatsApp
          </button>
          {showShareMessage && (
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              Se ha abierto WhatsApp para compartir el enlace.
            </p>
          )}
        </div>

        {/* Manage Medications Modal */}
        {showManageMedications && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <h3 className="text-2xl font-bold mb-4 text-indigo-700 dark:text-indigo-400">Administrar Medicamentos</h3>

              {/* Add/Edit Medication Form */}
              <div className="mb-6 p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                <h4 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-200">
                  {editMedicationId ? 'Editar Medicamento' : 'Añadir Nuevo Medicamento'}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label htmlFor="medName" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Nombre:</label>
                    <input
                      type="text"
                      id="medName"
                      ref={newMedNameRef}
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                      value={newMedication.name}
                      onChange={(e) => setNewMedication({ ...newMedication, name: e.target.value })}
                      placeholder="Nombre del medicamento"
                    />
                  </div>
                  <div>
                    <label htmlFor="medDosage" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Dosis (opcional):</label>
                    <input
                      type="text"
                      id="medDosage"
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                      value={newMedication.dosage}
                      onChange={(e) => setNewMedication({ ...newMedication, dosage: e.target.value })}
                      placeholder="Ej. 500mg, 1/2"
                    />
                  </div>
                  <div>
                    <label htmlFor="medTime" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Horario:</label>
                    <select
                      id="medTime"
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                      value={newMedication.time}
                      onChange={(e) => setNewMedication({ ...newMedication, time: e.target.value })}
                    >
                      <option value="">Selecciona un horario</option>
                      <option value="Ayunas">Ayunas</option>
                      <option value="Mañana Post desayuno">Mañana Post desayuno</option>
                      <option value="Antes de Comer 13hs">Antes de Comer (13hs)</option>
                      <option value="Tarde 18hs">Tarde (18hs)</option>
                      <option value="Noche">Noche</option>
                      <option value="Mensual">Mensual</option>
                      <option value="Según necesidad">Según necesidad</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="medFrequency" className="block text-sm font-medium text-gray-700 dark:text-gray-300">Frecuencia:</label>
                    <input
                      type="text"
                      id="medFrequency"
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-600 text-gray-900 dark:text-gray-100"
                      value={newMedication.frequency}
                      onChange={(e) => setNewMedication({ ...newMedication, frequency: e.target.value })}
                      placeholder="Ej. Diario, Martes/Jueves/Sábados"
                    />
                  </div>
                </div>
                <button
                  onClick={handleAddEditMedication}
                  className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg shadow-md transition-transform transform hover:scale-105 mr-2"
                >
                  {editMedicationId ? 'Guardar Cambios' : 'Añadir Medicamento'}
                </button>
                {editMedicationId && (
                  <button
                    onClick={() => {
                      setNewMedication({ id: '', name: '', dosage: '', time: '', frequency: '' });
                      setEditMedicationId(null);
                    }}
                    className="px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg shadow-md transition-transform transform hover:scale-105"
                  >
                    Cancelar Edición
                  </button>
                )}
              </div>

              {/* Current Medications List */}
              <h4 className="text-xl font-semibold mb-3 text-gray-800 dark:text-gray-200">Medicamentos Actuales:</h4>
              <ul className="space-y-3">
                {medicationDefinitions.map((med) => (
                  <li key={med.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg shadow-sm">
                    <div className="flex-1 mb-2 sm:mb-0">
                      <span className="font-bold text-lg">{med.name}</span>{' '}
                      {med.dosage && <span className="text-gray-600 dark:text-gray-300 text-sm">({med.dosage})</span>}
                      <br />
                      <span className="text-gray-500 dark:text-gray-400 text-sm">Horario: {med.time} | Frecuencia: {med.frequency}</span>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleEditClick(med)}
                        className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md text-sm transition-transform transform hover:scale-105"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => handleDeleteMedication(med.id)}
                        className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-md text-sm transition-transform transform hover:scale-105"
                      >
                        Eliminar
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setShowManageMedications(false)}
                className="mt-6 w-full px-4 py-2 bg-gray-300 hover:bg-gray-400 text-gray-800 rounded-lg shadow-md transition-transform transform hover:scale-105"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
// Export App to the global window object so ReactDOM.render can find it
window.App = App;