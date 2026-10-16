import PlusMark from "./PlusMark";

export default function DocumentPage({ kind }: { kind: string }) {
  if (kind === "blank") return <div className="page page-blank"><PlusMark /></div>;
  if (kind === "data") return <div className="page page-data"><strong>FICHIER DE DONNÉES</strong><span>EXCEL / CSV</span></div>;
  if (kind === "lab") return <div className="page page-lab"><strong>RAPPORT D’EXPÉRIENCE<br />AU LABORATOIRE</strong><div className="molecule"><i /><i /><i /><i /><i /><i /><i /></div><small>Votre nom</small></div>;
  if (kind === "mla") return <div className="page page-mla"><small>Votre nom<br />Nom du professeur<br />Sujet<br />8 septembre 2025</small><b>Titre de votre rapport</b>{Array.from({ length: 12 }).map((_, i) => <i key={i} />)}</div>;
  if (kind === "science") return <div className="page page-science"><strong>LES CELLULES<br />UNITÉS DE BASE<br />DE LA VIE</strong><div className="cell-art"><i /><i /><i /><i /></div><b>INTRODUCTION</b><p>Notre monde vivant est composé de structures fascinantes.</p></div>;
  if (kind === "photo") return <div className="page page-photo"><b>TITRE DU RAPPORT</b><small>INSÉREZ VOTRE TEXTE ICI</small><div className="mountain-photo"><span /></div><strong>Introduction</strong><p>Présentez ici les informations essentielles de votre rapport.</p></div>;
  if (kind === "reading") return <div className="page page-reading"><em>Fiche de lecture</em><strong>Nom du livre</strong><i /><small>Ton nom<br />8 septembre 2025</small></div>;
  if (kind === "notes") return <div className="page page-notes"><div className="book">▤</div><strong>Notes de cours</strong><small>Date : 09/09/2025</small><b>Sciences sociales</b><p>• Notes importantes et idées principales<br />• Concepts abordés pendant le cours</p></div>;
  if (kind === "questions") return <div className="page page-questions"><b>PARTIE 1 — Questions générales</b><strong>1. Présentez votre projet en une minute.</strong><p>Réponse<br />Mon projet consiste à développer une synthèse claire et structurée.</p><strong>2. Quel est le problème que vous résolvez ?</strong><p>Cette solution permet de mieux organiser les informations.</p></div>;
  if (kind === "internship") return <div className="page page-internship"><small>École Supérieure Privée de Management</small><div className="brands">esprit®　◇</div><strong>RAPPORT DE STAGE</strong><i /><b>Business Analytics</b><p>Soutenu par :<br /><br />Intitulé du sujet de stage</p></div>;
  if (kind === "arabic") return <div className="page page-arabic" dir="rtl"><small>المملكة المغربية<br />جامعة العلوم والتكنولوجيا</small><strong>تقرير اختبار عملي</strong><p>مقدمة<br />يهدف هذا التقرير إلى تقديم نتائج البحث وتحليلها بشكل واضح ومختصر.</p></div>;
  if (kind === "outline") return <div className="page page-outline"><b>NOTES DE RECHERCHE</b><i /><strong>Introduction</strong><p>Objectifs et contexte de l’étude</p><strong>Points essentiels</strong><p>• Première observation<br />• Deuxième observation<br />• Conclusion</p></div>;
  return <div className="page page-minimal"><small>[nom]<br />[prénom]<br />[date]</small><span /></div>;
}
