/**
 * Sample questions for the chat — quick starts grouped by the corpus folders
 * in `rag-ingest/corpus/` (faq, loyalty, policies, products, support).
 *
 * The Northwind Outfitters corpus is in Dutch, so the samples are Dutch too.
 * Surfaced in the UI via a "+" button next to the input that opens a grouped
 * picker; selecting one fills and sends it. Ordered per group to match the
 * actual support topics.
 */

/** A single proposed question. */
export interface SampleQuestion {
  text: string;
}

/** A group of sample questions, one per corpus folder. */
export interface SampleGroup {
  /** Corpus folder name (matches `rag-ingest/corpus/<folder>`). */
  folder: string;
  label: string;
  questions: SampleQuestion[];
}

const PRODUCTS: SampleQuestion[] = [
  { text: 'Geef me outdoor slaapzak comfort advies?' },
  { text: 'Wat is de comforttemperatuur van de Nachtenbloem slaapzak?' },
  { text: 'Hoe zet ik de trekking tent het snelst op?' },
  { text: 'Is de wandelrugzak waterdicht en klikt het op het frame?' },
  { text: 'Hoe onderhoud ik mijn wandelschoenen na een modderige tocht?' },
  { text: 'Wat is de maximale draaglast van de kampeerstoel?' },
];

const FAQ: SampleQuestion[] = [
  { text: 'Wat is de retourtermijn voor een artikel?' },
  { text: 'Hoe lang is de garantie op outdoor uitrusting?' },
  { text: 'Wat kost verzending en hoe lang duurt het?' },
  { text: 'Hoe was ik een slaapzak met kunstvezelvulling?' },
  { text: 'Tot wanneer kan ik een product retourneren?' },
];

const POLICIES: SampleQuestion[] = [
  { text: 'Wanneer zie ik mijn terugbetaling op mijn rekening?' },
  { text: 'Kan ik een seizoensaankoop annuleren of terugsturen?' },
  { text: 'Geldt er een wachttijd voor terugbetaling bij acties?' },
  { text: 'Naar welk bedrag word ik terugbetaald bij retour?' },
  { text: 'Hoe werkt annuleren van een bestelling?' },
];

const LOYALTY: SampleQuestion[] = [
  { text: 'Hoe verzamel ik punten met het beloningsprogramma?' },
  { text: 'Kan een cadeaubon worden ingewisseld tegen contant geld?' },
  { text: 'Hoe verlopen cadeaubonnen en hun geldigheid?' },
  { text: 'Welke maat moet ik kiezen volgens de maattabel?' },
  { text: 'Wat kan ik met mijn punten doen?' },
];

const SUPPORT: SampleQuestion[] = [
  { text: 'Mijn slaapzak is onderweg verloren gegaan, wat nu?' },
  { text: 'De ritssluiting van mijn tent is kapot, fix of vervang?' },
  { text: 'Mijn tent is beschadigd tijdens de vakantie, gedekt door garantie?' },
  { text: 'Hoe dien ik een schadeclaim in voor een product?' },
  { text: 'De slaapzak is nat geworden, blijft deze warm?' },
];

/** Grouped sample questions, in corpus-folder display order. */
export const SAMPLE_GROUPS: SampleGroup[] = [
  { folder: 'products', label: 'Producten', questions: PRODUCTS },
  { folder: 'faq', label: 'Veelgestelde vragen', questions: FAQ },
  { folder: 'policies', label: 'Beleid & retour', questions: POLICIES },
  { folder: 'loyalty', label: 'Klantenkaart & cadeau', questions: LOYALTY },
  { folder: 'support', label: 'Support & service', questions: SUPPORT },
];