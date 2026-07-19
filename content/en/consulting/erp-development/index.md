---
title: "ERP Development"
description: "Multi-tenant ERP platforms — sales, inventory, CRM, and finance modules — built on ABP Framework microservices and modular monolith architecture."
hero_title: "ERP Development"
hero_lead: "I build multi-tenant ERP platforms on ABP Framework — from a live modular ERP covering sales, inventory, and CRM, to founding-engineer work on a 17-service microservices platform spanning CRM, Sales, Inventory, Finance, and Payments."
badge: "Case Study"
intro_title: "Real ERP modules in production, not a theoretical framework demo"
intro: "I currently lead architecture evolution across enterprise SaaS platforms including ERP, CRM, and Inventory systems, and was founding engineer on a 17-service ABP microservices platform covering the same domains for a US client."
checklist:
  - "Multi-tenant ERP: sales, inventory, and CRM modules"
  - "Microservices or modular monolith, matched to what the product actually needs"
  - "Schema-per-service data isolation where microservices are the right call"
  - "Event-driven integration between modules (RabbitMQ, Inbox/Outbox pattern)"
  - "Centralized authentication across every service (OpenIddict)"
deliverables:
  - "ERP modules: sales, inventory, CRM, finance"
  - "API gateway (YARP) for microservices architectures"
  - "Event-driven integration between modules"
  - "Centralized authentication"
  - "Deployment-ready setup"
case_studies:
  - name: "Live Multi-Tenant ERP Platform"
    meta: "Microservices / Modular — ABP Framework, .NET, Angular, PostgreSQL"
    points:
      - "Live multi-tenant ERP covering sales, inventory, and CRM modules"
      - "Currently leading architecture evolution across this and adjacent enterprise SaaS platforms"
  - name: "17-Service ABP Microservices Platform"
    meta: "US client (via Upwork) — founding engineer"
    points:
      - "Greenfield 17-service enterprise SaaS platform covering CRM, Sales, Inventory, Finance, and Payments"
      - "Designed the full microservice architecture: YARP API gateway, schema-per-service PostgreSQL, RabbitMQ event bus, centralized OpenIddict authentication"
      - "Onboarded engineers onto a 117-project solution and established ABP best practices across 10 business domains"
tech_stack: ["ABP Framework", ".NET / C#", "Angular", "PostgreSQL", "YARP", "RabbitMQ", "Redis", "OpenIddict", "Microservices", "Modular Monolith", "CQRS", "MediatR"]
faqs:
  - q: "Do you build ERP systems as microservices or a monolith?"
    a: "Whichever fits the actual requirements. I've built a 17-service microservices ERP platform (schema-per-service, YARP gateway, event-driven via RabbitMQ) and modular monolith ERP systems in the same domains. Microservices earn their complexity from independent deployment and team autonomy needs, not from assumptions about future scale."
  - q: "What ERP modules have you actually built?"
    a: "Sales, inventory, CRM, and finance, across a live multi-tenant ERP platform and a 17-service microservices platform built as founding engineer for a US client."
  - q: "Can you onboard a team onto an ERP codebase, not just build it solo?"
    a: "Yes — on the 17-service platform I onboarded engineers onto a 117-project solution and established ABP best practices across 10 business domains."
  - q: "How do modules communicate in a microservices ERP?"
    a: "Event-driven, via a RabbitMQ event bus with an Inbox/Outbox pattern for reliability, behind a YARP API gateway with centralized OpenIddict authentication across every service."
cta_title: "Building or modernizing an ERP platform?"
cta_lead: "Sales, inventory, CRM, finance — I've built these modules in both microservices and modular monolith form. Let's talk about what your team actually needs."
---
