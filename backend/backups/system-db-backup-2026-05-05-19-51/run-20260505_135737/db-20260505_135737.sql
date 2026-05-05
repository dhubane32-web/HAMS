--
-- PostgreSQL database dump
--

\restrict SohRs4jLGeVJha1OFj8OOTLtPTcZ1GV9KJQrz7wuuvAtJbU4LYWSxF7Q7at2wmh

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'finance',
    'operations',
    'agent',
    'crew',
    'maintenance',
    'booking_agent',
    'checkin_agent',
    'super_admin'
);


--
-- Name: sm_seat_leg_allocation_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sm_seat_leg_allocation_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: aircraft; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.aircraft (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tail_number character varying(20) NOT NULL,
    model character varying(80) NOT NULL,
    seat_capacity integer NOT NULL,
    release_status character varying(30) DEFAULT 'RELEASED'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    aircraft_type_id uuid,
    seat_map_id uuid
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    action character varying(100) NOT NULL,
    entity character varying(100),
    entity_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    ip_address character varying(64),
    user_agent text
);


--
-- Name: baggage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.baggage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    checkin_id uuid NOT NULL,
    tag_number character varying(30) NOT NULL,
    weight_kg numeric(6,2) NOT NULL,
    pieces integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    excess_charge numeric(12,2) DEFAULT 0 NOT NULL
);


--
-- Name: booking_flights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_flights (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    flight_id uuid NOT NULL,
    cabin_class character varying(20) DEFAULT 'ECONOMY'::character varying NOT NULL,
    fare_amount numeric(12,2) NOT NULL,
    fare_class_id uuid,
    leg_type character varying(10) DEFAULT 'OUTBOUND'::character varying NOT NULL
);


--
-- Name: booking_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.booking_passengers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    passenger_id uuid NOT NULL,
    passenger_type character varying(10) DEFAULT 'ADT'::character varying NOT NULL
);


--
-- Name: bookings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bookings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    pnr character varying(10) NOT NULL,
    booking_status character varying(20) DEFAULT 'HOLD'::character varying NOT NULL,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payment_status character varying(20) DEFAULT 'PAID'::character varying NOT NULL,
    notes text,
    promo_code_id uuid,
    campaign_id uuid,
    promo_discount_amount numeric(12,2) DEFAULT 0 NOT NULL,
    return_date date,
    fare_breakdown jsonb,
    fare_base_total numeric(12,2),
    fare_tax_total numeric(12,2),
    fare_fee_total numeric(12,2),
    trip_type character varying(20) DEFAULT 'ONE_WAY'::character varying NOT NULL,
    sales_channel_code character varying(40) DEFAULT 'DIRECT_WEB'::character varying NOT NULL,
    corporate_account_id uuid,
    travel_agent_id uuid,
    CONSTRAINT bookings_payment_status_check CHECK (((payment_status)::text = ANY ((ARRAY['UNPAID'::character varying, 'PARTIALLY_PAID'::character varying, 'PAID'::character varying, 'REFUNDED'::character varying, 'PENDING'::character varying, 'FAILED'::character varying])::text[])))
);


--
-- Name: checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkins (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    passenger_id uuid NOT NULL,
    flight_id uuid NOT NULL,
    seat_number character varying(8),
    checkin_time timestamp with time zone DEFAULT now() NOT NULL,
    checked_in_by uuid,
    boarding_pass_no character varying(30),
    boarding_status character varying(20) DEFAULT 'CHECKED_IN'::character varying NOT NULL,
    checkin_status character varying(20) DEFAULT 'COMPLETED'::character varying NOT NULL,
    boarded_at timestamp with time zone,
    boarding_gate character varying(20),
    boarding_sequence integer,
    CONSTRAINT checkins_boarding_status_check CHECK (((boarding_status)::text = ANY ((ARRAY['CHECKED_IN'::character varying, 'BOARDING'::character varying, 'BOARDED'::character varying, 'NO_SHOW'::character varying])::text[]))),
    CONSTRAINT checkins_checkin_status_check CHECK (((checkin_status)::text = ANY ((ARRAY['PENDING'::character varying, 'COMPLETED'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: crew_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_assignments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_id uuid NOT NULL,
    crew_user_id uuid NOT NULL,
    duty_role character varying(50) NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_availability (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    status character varying(20) NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crew_availability_period_check CHECK ((period_end > period_start)),
    CONSTRAINT crew_availability_status_check CHECK (((status)::text = ANY ((ARRAY['AVAILABLE'::character varying, 'UNAVAILABLE'::character varying])::text[])))
);


--
-- Name: crew_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_documents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    doc_type character varying(60) NOT NULL,
    title character varying(200) NOT NULL,
    reference_number character varying(120),
    issue_date date,
    expiry_date date,
    storage_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_duty_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_duty_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    flight_id uuid NOT NULL,
    duty_start timestamp with time zone NOT NULL,
    duty_end timestamp with time zone NOT NULL,
    rest_until timestamp with time zone NOT NULL,
    duty_minutes integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_licenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_licenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    license_type character varying(40) NOT NULL,
    license_number character varying(80),
    issuing_authority character varying(120),
    issue_date date,
    expiry_date date NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_medicals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_medicals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    medical_class character varying(20),
    expiry_date date NOT NULL,
    examiner_name character varying(120),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: crew_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_profiles (
    user_id uuid NOT NULL,
    crew_category character varying(20) NOT NULL,
    employee_number character varying(40),
    base_airport character varying(10),
    phone character varying(40),
    emergency_contact character varying(150),
    hire_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT crew_profiles_category_check CHECK (((crew_category)::text = ANY ((ARRAY['PILOT'::character varying, 'CABIN'::character varying])::text[])))
);


--
-- Name: crew_training; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.crew_training (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    training_code character varying(40) NOT NULL,
    title character varying(200) NOT NULL,
    completed_date date,
    expiry_date date,
    instructor character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cs_case_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cs_case_notes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    case_id uuid NOT NULL,
    body text NOT NULL,
    is_internal boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cs_customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cs_customer_profiles (
    passenger_id uuid NOT NULL,
    preferred_language character varying(20),
    vip_flag boolean DEFAULT false NOT NULL,
    service_notes text,
    preferred_contact character varying(40),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cs_service_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cs_service_cases (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    case_ref character varying(32) NOT NULL,
    case_type character varying(30) NOT NULL,
    status character varying(30) DEFAULT 'OPEN'::character varying NOT NULL,
    priority character varying(20) DEFAULT 'NORMAL'::character varying NOT NULL,
    passenger_id uuid,
    booking_id uuid,
    baggage_id uuid,
    refund_request_id uuid,
    subject character varying(300) NOT NULL,
    description text,
    metadata jsonb,
    assigned_to uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT cs_service_cases_priority_check CHECK (((priority)::text = ANY ((ARRAY['LOW'::character varying, 'NORMAL'::character varying, 'HIGH'::character varying, 'URGENT'::character varying])::text[]))),
    CONSTRAINT cs_service_cases_status_check CHECK (((status)::text = ANY ((ARRAY['OPEN'::character varying, 'IN_PROGRESS'::character varying, 'WAITING_CUSTOMER'::character varying, 'RESOLVED'::character varying, 'CLOSED'::character varying])::text[]))),
    CONSTRAINT cs_service_cases_type_check CHECK (((case_type)::text = ANY ((ARRAY['SUPPORT'::character varying, 'COMPLAINT'::character varying, 'REFUND_REQUEST'::character varying, 'BOOKING_CHANGE'::character varying, 'LOST_BAGGAGE'::character varying, 'GENERAL'::character varying])::text[])))
);


--
-- Name: customer_cases; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.customer_cases AS
 SELECT id,
    case_ref,
    case_type,
    status,
    priority,
    passenger_id,
    booking_id,
    baggage_id,
    refund_request_id,
    subject,
    description,
    metadata,
    assigned_to,
    created_by,
    created_at,
    updated_at,
    closed_at
   FROM public.cs_service_cases;


--
-- Name: dispatch_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dispatch_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_id uuid NOT NULL,
    dispatch_status character varying(20) NOT NULL,
    remarks text,
    dispatched_by uuid,
    dispatched_at timestamp with time zone DEFAULT now() NOT NULL,
    checklist_json jsonb
);


--
-- Name: finance_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_expenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    category character varying(60) NOT NULL,
    amount numeric(14,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    incurred_on date NOT NULL,
    description text,
    reference character varying(120),
    flight_id uuid,
    entered_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: finance_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.finance_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    txn_type character varying(50) NOT NULL,
    amount numeric(14,2),
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    booking_id uuid,
    payment_id uuid,
    refund_id uuid,
    refund_request_id uuid,
    expense_id uuid,
    description text,
    metadata jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: flight_delays; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flight_delays (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_id uuid NOT NULL,
    delay_minutes integer NOT NULL,
    reason text NOT NULL,
    reported_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    revised_departure timestamp with time zone,
    operational_notes text,
    CONSTRAINT flight_delays_delay_minutes_check CHECK ((delay_minutes >= 1))
);


--
-- Name: flights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.flights (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_number character varying(20) NOT NULL,
    departure_airport character varying(10) NOT NULL,
    arrival_airport character varying(10) NOT NULL,
    departure_time timestamp with time zone NOT NULL,
    arrival_time timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'SCHEDULED'::character varying NOT NULL,
    aircraft_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    route_id uuid,
    cancellation_reason text,
    cancelled_at timestamp with time zone,
    gate character varying(10),
    boarding_time timestamp with time zone,
    checkin_closed_at timestamp with time zone,
    checkin_closed_by uuid,
    CONSTRAINT flights_status_check CHECK (((status)::text = ANY ((ARRAY['SCHEDULED'::character varying, 'CHECKIN_OPEN'::character varying, 'BOARDING'::character varying, 'GATE_CLOSED'::character varying, 'DEPARTED'::character varying, 'IN_AIR'::character varying, 'ARRIVED'::character varying, 'DELAYED'::character varying, 'CANCELLED'::character varying])::text[])))
);


--
-- Name: login_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    email character varying(150) NOT NULL,
    success boolean NOT NULL,
    ip_address character varying(64),
    user_agent text,
    reason character varying(120),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: maintenance_inspections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_inspections (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    aircraft_id uuid NOT NULL,
    inspection_type character varying(60) NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status character varying(20) DEFAULT 'SCHEDULED'::character varying NOT NULL,
    remarks text,
    scheduled_by uuid,
    completed_by uuid,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: maintenance_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.maintenance_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    aircraft_id uuid NOT NULL,
    defect_code character varying(50),
    defect_description text NOT NULL,
    severity character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    opened_by uuid,
    closed_by uuid,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone
);


--
-- Name: md_aircraft_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_aircraft_types (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    default_seat_capacity integer DEFAULT 150 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_airports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_airports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    iata_code character varying(3) NOT NULL,
    name character varying(160) NOT NULL,
    country_id uuid,
    city_id uuid,
    timezone character varying(64),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_baggage_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_baggage_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    route_id uuid,
    fare_class_id uuid,
    free_pieces integer DEFAULT 1 NOT NULL,
    free_weight_kg numeric(8,2) DEFAULT 23 NOT NULL,
    max_weight_per_piece_kg numeric(8,2) DEFAULT 32 NOT NULL,
    charge_per_kg_over numeric(12,2) DEFAULT 0 NOT NULL,
    currency character(3) DEFAULT 'USD'::bpchar NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_cities (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    country_id uuid NOT NULL,
    name character varying(120) NOT NULL,
    iata_code character varying(3),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_countries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    iso2 character(2) NOT NULL,
    name character varying(120) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_currencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_currencies (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character(3) NOT NULL,
    name character varying(80) NOT NULL,
    decimal_places integer DEFAULT 2 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_departments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_departments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    parent_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_fare_classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_fare_classes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(120) NOT NULL,
    booking_class character varying(20) DEFAULT 'ECONOMY'::character varying NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT md_fare_classes_booking_class_check CHECK (((booking_class)::text = ANY ((ARRAY['ECONOMY'::character varying, 'BUSINESS'::character varying, 'FIRST'::character varying])::text[])))
);


--
-- Name: md_fee_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_fee_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    amount_fixed numeric(12,2) DEFAULT 0 NOT NULL,
    rate_percent numeric(8,4) DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_payment_methods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_payment_methods (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(120) NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_role_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_role_definitions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    role_key public.user_role NOT NULL,
    display_name character varying(120) NOT NULL,
    description text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_route_fares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_route_fares (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    route_id uuid NOT NULL,
    fare_class_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'USD'::bpchar NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_routes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    origin_airport_id uuid NOT NULL,
    dest_airport_id uuid NOT NULL,
    distance_nm integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT md_routes_check CHECK ((origin_airport_id <> dest_airport_id))
);


--
-- Name: md_seat_maps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_seat_maps (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    aircraft_type_id uuid NOT NULL,
    layout_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_system_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_system_preferences (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    pref_key character varying(80) NOT NULL,
    pref_value text NOT NULL,
    value_type character varying(20) DEFAULT 'STRING'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: md_tax_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.md_tax_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(120) NOT NULL,
    rate_percent numeric(8,4) DEFAULT 0 NOT NULL,
    applies_to character varying(20) DEFAULT 'SUBTOTAL'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT md_tax_settings_applies_to_check CHECK (((applies_to)::text = ANY ((ARRAY['SUBTOTAL'::character varying, 'TOTAL'::character varying])::text[])))
);


--
-- Name: ops_routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_routes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    origin_airport character varying(10) NOT NULL,
    dest_airport character varying(10) NOT NULL,
    label character varying(160),
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passengers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    first_name character varying(100) NOT NULL,
    last_name character varying(100) NOT NULL,
    date_of_birth date,
    nationality character varying(80),
    passport_no character varying(50),
    phone character varying(40),
    email character varying(150),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    gender character varying(20),
    passport_expiry date,
    emergency_contact character varying(150)
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid,
    payment_type character varying(20) NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    payment_status character varying(20) DEFAULT 'SUCCESS'::character varying NOT NULL,
    transaction_ref character varying(100),
    processed_by uuid,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_payment_status_check CHECK ((upper(TRIM(BOTH FROM payment_status)) = ANY (ARRAY['PENDING'::text, 'PAID'::text, 'FAILED'::text, 'REFUNDED'::text, 'PARTIALLY_REFUNDED'::text])))
);


--
-- Name: refund_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refund_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    payment_id uuid NOT NULL,
    amount numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    reason text,
    status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    requested_by uuid NOT NULL,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refund_requests_status_check CHECK (((status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying])::text[])))
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    payment_id uuid NOT NULL,
    refund_amount numeric(12,2) NOT NULL,
    reason text,
    approved_by uuid,
    refunded_at timestamp with time zone DEFAULT now() NOT NULL,
    refund_request_id uuid
);


--
-- Name: sales_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_campaigns (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(200) NOT NULL,
    channel character varying(80),
    start_date date NOT NULL,
    end_date date NOT NULL,
    budget_amount numeric(14,2),
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    utm_source character varying(120),
    utm_medium character varying(120),
    utm_campaign character varying(160),
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_campaigns_dates_check CHECK ((end_date >= start_date))
);


--
-- Name: sales_corporate_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_corporate_customers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    legal_name character varying(200) NOT NULL,
    tax_id character varying(80),
    billing_email character varying(150),
    phone character varying(40),
    default_discount_percent numeric(5,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    credit_limit numeric(14,2),
    credit_balance numeric(14,2),
    payment_terms character varying(40),
    billing_cycle_days integer,
    travel_policy_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    fare_agreement_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT sales_corporate_customers_billing_cycle_days_check CHECK (((billing_cycle_days IS NULL) OR (billing_cycle_days > 0))),
    CONSTRAINT sales_corporate_customers_default_discount_percent_check CHECK (((default_discount_percent IS NULL) OR ((default_discount_percent >= (0)::numeric) AND (default_discount_percent <= (100)::numeric))))
);


--
-- Name: sales_customer_segments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_customer_segments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    rules_json jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_leads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_leads (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_name character varying(200),
    contact_name character varying(150) NOT NULL,
    email character varying(150),
    phone character varying(40),
    source character varying(80),
    status character varying(20) DEFAULT 'NEW'::character varying NOT NULL,
    expected_value numeric(14,2),
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    assigned_to uuid,
    campaign_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_leads_status_check CHECK (((status)::text = ANY ((ARRAY['NEW'::character varying, 'CONTACTED'::character varying, 'QUALIFIED'::character varying, 'PROPOSAL'::character varying, 'NEGOTIATION'::character varying, 'WON'::character varying, 'LOST'::character varying])::text[])))
);


--
-- Name: sales_promo_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_promo_codes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(40) NOT NULL,
    description character varying(500),
    discount_type character varying(20) NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'USD'::character varying NOT NULL,
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    usage_limit integer NOT NULL,
    used_count integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sales_promo_codes_dates_check CHECK ((valid_until >= valid_from)),
    CONSTRAINT sales_promo_codes_type_check CHECK (((discount_type)::text = ANY ((ARRAY['PERCENT'::character varying, 'FIXED_AMOUNT'::character varying])::text[]))),
    CONSTRAINT sales_promo_codes_usage_check CHECK ((used_count <= usage_limit)),
    CONSTRAINT sales_promo_codes_usage_limit_check CHECK ((usage_limit >= 1)),
    CONSTRAINT sales_promo_codes_used_count_check CHECK ((used_count >= 0))
);


--
-- Name: sales_route_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_route_promotions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    promo_code_id uuid NOT NULL,
    origin_airport character varying(10) NOT NULL,
    dest_airport character varying(10) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_segment_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_segment_members (
    segment_id uuid NOT NULL,
    passenger_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sales_travel_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_travel_agents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    company_name character varying(200) NOT NULL,
    contact_name character varying(150),
    email character varying(150),
    phone character varying(40),
    iata_code character varying(20),
    user_id uuid,
    commission_percent numeric(5,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    approval_status character varying(20) DEFAULT 'APPROVED'::character varying NOT NULL,
    credit_limit numeric(14,2),
    credit_balance numeric(14,2),
    debt_balance numeric(14,2) DEFAULT 0 NOT NULL,
    CONSTRAINT sales_travel_agents_approval_check CHECK (((approval_status)::text = ANY ((ARRAY['PENDING'::character varying, 'APPROVED'::character varying, 'REJECTED'::character varying, 'SUSPENDED'::character varying])::text[]))),
    CONSTRAINT sales_travel_agents_commission_percent_check CHECK (((commission_percent IS NULL) OR ((commission_percent >= (0)::numeric) AND (commission_percent <= (100)::numeric))))
);


--
-- Name: sm_agent_commissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_agent_commissions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    ticket_id uuid,
    travel_agent_id uuid,
    channel_code character varying(40),
    base_amount numeric(14,2) NOT NULL,
    commission_rate numeric(8,4) NOT NULL,
    commission_amount numeric(14,2) NOT NULL,
    currency character(3) DEFAULT 'USD'::bpchar NOT NULL,
    status character varying(20) DEFAULT 'ACCRUED'::character varying NOT NULL,
    rule_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_ancillary_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_ancillary_products (
    code character varying(40) NOT NULL,
    label character varying(160) NOT NULL,
    category character varying(40) NOT NULL,
    default_price numeric(12,2) DEFAULT 0 NOT NULL,
    currency character(3) DEFAULT 'USD'::bpchar NOT NULL,
    active boolean DEFAULT true NOT NULL
);


--
-- Name: sm_ancillary_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_ancillary_sales (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    product_code character varying(40) NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    currency character(3) DEFAULT 'USD'::bpchar NOT NULL,
    status character varying(20) DEFAULT 'CONFIRMED'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_ancillary_sales_quantity_check CHECK ((quantity > 0))
);


--
-- Name: sm_automation_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_automation_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    trigger_code character varying(48) NOT NULL,
    channel character varying(16) DEFAULT 'EMAIL'::character varying NOT NULL,
    campaign_id uuid,
    template_key character varying(120),
    schedule_cron character varying(80),
    active boolean DEFAULT true NOT NULL,
    metadata_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_automation_channel CHECK (((channel)::text = ANY ((ARRAY['EMAIL'::character varying, 'SMS'::character varying, 'SOCIAL'::character varying])::text[])))
);


--
-- Name: sm_commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_commission_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rule_type character varying(24) NOT NULL,
    channel_code character varying(40),
    origin_airport character varying(10),
    dest_airport character varying(10),
    promo_code_id uuid,
    commission_percent numeric(8,4) NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_commission_rules_commission_percent_check CHECK (((commission_percent >= (0)::numeric) AND (commission_percent <= (100)::numeric))),
    CONSTRAINT sm_commission_rules_type CHECK (((rule_type)::text = ANY ((ARRAY['STANDARD'::character varying, 'ROUTE'::character varying, 'PROMO'::character varying, 'VOLUME'::character varying, 'OVERRIDE'::character varying, 'BONUS'::character varying])::text[])))
);


--
-- Name: sm_corporate_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_corporate_contracts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    corporate_id uuid NOT NULL,
    title character varying(200) NOT NULL,
    discount_percent numeric(6,3),
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    contract_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_corporate_contracts_dates CHECK ((valid_until >= valid_from)),
    CONSTRAINT sm_corporate_contracts_discount_percent_check CHECK (((discount_percent IS NULL) OR ((discount_percent >= (0)::numeric) AND (discount_percent <= (100)::numeric))))
);


--
-- Name: sm_corporate_travelers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_corporate_travelers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    corporate_id uuid NOT NULL,
    passenger_id uuid NOT NULL,
    employee_ref character varying(80),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_crm_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_crm_customers (
    passenger_id uuid NOT NULL,
    status character varying(20) DEFAULT 'ACTIVE'::character varying NOT NULL,
    segment_tag character varying(80),
    total_spend numeric(14,2) DEFAULT 0 NOT NULL,
    booking_count integer DEFAULT 0 NOT NULL,
    preferred_routes_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    complaint_count integer DEFAULT 0 NOT NULL,
    last_booking_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_crm_customers_status CHECK (((status)::text = ANY ((ARRAY['ACTIVE'::character varying, 'INACTIVE'::character varying, 'VIP'::character varying])::text[])))
);


--
-- Name: sm_dynamic_pricing_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_dynamic_pricing_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(160) NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    conditions_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    adjustment_type character varying(16) DEFAULT 'PERCENT'::character varying NOT NULL,
    adjustment_value numeric(12,4) DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_dyn_adj_type CHECK (((adjustment_type)::text = ANY ((ARRAY['PERCENT'::character varying, 'FIXED_AMOUNT'::character varying])::text[])))
);


--
-- Name: sm_fare_class_family_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_fare_class_family_map (
    fare_class_id uuid NOT NULL,
    family_id uuid NOT NULL
);


--
-- Name: sm_fare_families; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_fare_families (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(32) NOT NULL,
    name character varying(160) NOT NULL,
    cabin character varying(20) DEFAULT 'ECONOMY'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL
);


--
-- Name: sm_fare_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_fare_rules (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    fare_class_id uuid,
    rule_key character varying(80) NOT NULL,
    rule_value_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_to date,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_lead_followups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_lead_followups (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    lead_id uuid NOT NULL,
    remind_at timestamp with time zone NOT NULL,
    note character varying(2000),
    completed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_loyalty_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_loyalty_accounts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    passenger_id uuid NOT NULL,
    miles_balance integer DEFAULT 0 NOT NULL,
    tier character varying(20) DEFAULT 'SILVER'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_loyalty_accounts_miles_balance_check CHECK ((miles_balance >= 0)),
    CONSTRAINT sm_loyalty_tier CHECK (((tier)::text = ANY ((ARRAY['SILVER'::character varying, 'GOLD'::character varying, 'PLATINUM'::character varying])::text[])))
);


--
-- Name: sm_loyalty_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_loyalty_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    loyalty_account_id uuid NOT NULL,
    txn_type character varying(16) NOT NULL,
    miles integer NOT NULL,
    booking_id uuid,
    description character varying(500),
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_loyalty_txn_type CHECK (((txn_type)::text = ANY ((ARRAY['EARN'::character varying, 'REDEEM'::character varying, 'ADJUST'::character varying, 'EXPIRE'::character varying])::text[])))
);


--
-- Name: sm_promo_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_promo_usage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    promo_code_id uuid NOT NULL,
    booking_id uuid NOT NULL,
    discount_amount numeric(14,2) DEFAULT 0 NOT NULL,
    used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_rm_flight_bucket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_rm_flight_bucket (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    flight_id uuid NOT NULL,
    fare_class_id uuid NOT NULL,
    seats_allocated integer DEFAULT 0 NOT NULL,
    seats_sold integer DEFAULT 0 NOT NULL,
    bucket_open boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_rm_flight_bucket_seats_allocated_check CHECK ((seats_allocated >= 0)),
    CONSTRAINT sm_rm_flight_bucket_seats_sold_check CHECK ((seats_sold >= 0))
);


--
-- Name: sm_rm_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_rm_policy (
    id smallint DEFAULT 1 NOT NULL,
    load_factor_close_bucket numeric(5,2) DEFAULT 0.78 NOT NULL,
    load_factor_open_upper numeric(5,2) DEFAULT 0.55 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_route_profitability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_route_profitability (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    origin_airport character varying(10) NOT NULL,
    dest_airport character varying(10) NOT NULL,
    revenue numeric(16,2) DEFAULT 0 NOT NULL,
    cost_estimate numeric(16,2) DEFAULT 0 NOT NULL,
    bookings integer DEFAULT 0 NOT NULL,
    passengers integer DEFAULT 0 NOT NULL,
    load_factor numeric(8,4),
    yield_per_pax numeric(14,4),
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sm_sales_channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_sales_channels (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(40) NOT NULL,
    name character varying(160) NOT NULL,
    default_commission_pct numeric(6,3) DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_sales_channels_default_commission_pct_check CHECK (((default_commission_pct >= (0)::numeric) AND (default_commission_pct <= (100)::numeric)))
);


--
-- Name: sm_seasonal_route_fare; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_seasonal_route_fare (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    origin_airport character varying(10) NOT NULL,
    dest_airport character varying(10) NOT NULL,
    fare_class_id uuid,
    season_start date NOT NULL,
    season_end date NOT NULL,
    fare_multiplier numeric(8,4) DEFAULT 1 NOT NULL,
    notes character varying(500),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sm_seasonal_route_fare_dates CHECK ((season_end >= season_start)),
    CONSTRAINT sm_seasonal_route_fare_fare_multiplier_check CHECK ((fare_multiplier > (0)::numeric))
);


--
-- Name: sm_seat_leg_allocation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sm_seat_leg_allocation (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    booking_id uuid NOT NULL,
    flight_id uuid NOT NULL,
    passenger_id uuid NOT NULL,
    ticket_id uuid NOT NULL,
    fare_class_id uuid,
    cabin_class character varying(20) DEFAULT 'ECONOMY'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    seat_number character varying(16),
    seat_status character varying(30) DEFAULT 'ALLOCATED'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tickets (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    ticket_number character varying(20) NOT NULL,
    booking_id uuid NOT NULL,
    passenger_id uuid NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    issued_by uuid,
    ticket_status character varying(20) DEFAULT 'ISSUED'::character varying NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    full_name character varying(150) NOT NULL,
    email character varying(150) NOT NULL,
    password_hash text NOT NULL,
    role public.user_role NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    password_reset_token character varying(128),
    password_reset_expires_at timestamp with time zone,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    totp_secret_enc text,
    totp_pending_secret_enc text,
    totp_enabled boolean DEFAULT false NOT NULL,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone
);


--
-- Data for Name: aircraft; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.aircraft (id, tail_number, model, seat_capacity, release_status, created_at, aircraft_type_id, seat_map_id) FROM stdin;
470e62a2-5aa1-44e1-8b8c-9c4133923397	5Y-HAW	Boeing 737-800	162	RELEASED	2026-05-01 13:38:26.389907+03	\N	\N
b4b09439-d73b-4dc6-8c63-84a41e7a4cbd	5Y-HAM	Airbus A320	150	RELEASED	2026-05-01 13:38:26.389907+03	\N	\N
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, user_id, action, entity, entity_id, metadata, created_at, ip_address, user_agent) FROM stdin;
565c8146-724f-4110-9630-fb39e8247983	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:39:40.799148+03	\N	\N
91bf6440-eba1-42b3-beda-1caca16005af	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:46:56.744474+03	\N	\N
efed1dd7-2505-4a8d-8823-27056f2d6b31	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:47:00.077916+03	\N	\N
dd4aa300-9e29-4e7d-9206-bd9c071114c3	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:47:00.877755+03	\N	\N
a4f1f4c8-7605-436c-8018-deefa59914ce	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:47:01.176546+03	\N	\N
83e95325-9244-40ee-a1fa-83e2a9838fe6	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:47:01.444334+03	\N	\N
3aed5733-c65b-4c1d-b7c9-3fc330988123	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:47:01.72899+03	\N	\N
9d3f00f7-d1fa-4cd8-95d0-8ab89516751c	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:48:00.034585+03	\N	\N
3474f178-0e7e-4402-b809-e4d672c2bad5	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:53:15.022022+03	\N	\N
a3d84156-563c-4078-815a-c4eec0fdc330	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:53:38.319767+03	\N	\N
b3b47775-c878-4a46-9ab6-3117ad061f94	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:54:10.819922+03	\N	\N
a0451752-dace-47bc-abe0-b4f8cf2e083c	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:35.936449+03	\N	\N
1c042369-68cc-4d8e-b940-247765013f68	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:41.506507+03	\N	\N
2e6c8016-5a0b-4677-825f-2a10b6d674d8	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:42.370115+03	\N	\N
eb36b33e-665a-47f2-ae2c-4521ccccda43	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:43.125287+03	\N	\N
5fe8d98f-ee5c-4ed4-85c6-4a807731440d	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:44.184386+03	\N	\N
07888915-7816-43c8-8792-c7deee37a8e2	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:44.418592+03	\N	\N
403719c1-b0be-40c2-8620-f2cb37b94bcb	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:44.620487+03	\N	\N
4dc32d62-1239-41ed-af2c-667ad651ff89	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:44.820067+03	\N	\N
9d3ddd9b-e821-4d41-8a7c-09b8f6949610	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:45.021703+03	\N	\N
ee705255-e3cc-4b8e-b706-20e1ed5e0574	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:45.223904+03	\N	\N
eb8506aa-e951-4f25-b587-ad777de33bb5	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:45.458109+03	\N	\N
775217e5-bb53-43d8-868c-774f9e17657a	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:55:45.657308+03	\N	\N
4b783edb-957d-4e49-b150-e3dc9c34c719	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:56:43.772313+03	\N	\N
0015436b-e72d-4eba-b008-1daeda30b2cc	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:58:56.499865+03	\N	\N
825c373e-7ca1-4a3b-9568-4401ab1fe006	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 13:58:57.576144+03	\N	\N
9ce412ab-effb-4ba6-a6a6-34929235eec5	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:02:16.478814+03	\N	\N
24a20711-11a0-4474-8eee-a13a9a00fe6b	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:02:23.251435+03	\N	\N
f31d7b1f-74ce-4042-abf7-513686536b5a	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:03:21.227889+03	\N	\N
0dfdb74c-604b-4c5e-9631-0e70a17a005e	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:03:42.144587+03	\N	\N
49594ef9-125d-4542-ba94-7f59c82220bc	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:07:01.331329+03	\N	\N
78e73abc-5612-43b2-8a98-d520c15b45db	49cfb4c6-7b52-484b-b7b2-54c5072230d2	LOGIN_SUCCESS	users	\N	{"email": "finance@hams.aero"}	2026-05-01 14:07:01.48276+03	\N	\N
a645b43d-7d78-4aa9-8481-f0f38565a86a	a12830a8-4d51-4ecf-bfc4-a170aa3f9b99	LOGIN_SUCCESS	users	\N	{"email": "ops@hams.aero"}	2026-05-01 14:07:01.61896+03	\N	\N
37b38eae-28f5-46fc-af44-c27500ac79f3	1d2241c6-92f4-4e6b-889a-55504ad448a0	LOGIN_SUCCESS	users	\N	{"email": "agent@hams.aero"}	2026-05-01 14:07:01.768452+03	\N	\N
675e3c1d-a85f-408f-831c-f82ac581193a	26236592-4ef9-45a7-9000-60df1cd8c89e	LOGIN_SUCCESS	users	\N	{"email": "crew@hams.aero"}	2026-05-01 14:07:01.901145+03	\N	\N
623ccc38-b306-4a71-9014-78f8a2dcebce	69a35569-645f-4139-944e-c21644a1685c	LOGIN_SUCCESS	users	\N	{"email": "mx@hams.aero"}	2026-05-01 14:07:02.018441+03	\N	\N
0b833c98-a7fd-468a-8f3c-359ab7ce5462	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:19:11.781818+03	\N	\N
d6791db5-d550-4c87-bde3-05773bbcd6a9	49cfb4c6-7b52-484b-b7b2-54c5072230d2	LOGIN_SUCCESS	users	\N	{"email": "finance@hams.aero"}	2026-05-01 14:19:11.897486+03	\N	\N
ca9f32c2-2023-49c0-bd88-a468ece4fe9f	a12830a8-4d51-4ecf-bfc4-a170aa3f9b99	LOGIN_SUCCESS	users	\N	{"email": "ops@hams.aero"}	2026-05-01 14:19:11.986226+03	\N	\N
88e1f290-5197-449c-88b1-5c9d5f26590e	1d2241c6-92f4-4e6b-889a-55504ad448a0	LOGIN_SUCCESS	users	\N	{"email": "agent@hams.aero"}	2026-05-01 14:19:12.073211+03	\N	\N
91332515-d51f-4115-bf81-26861397c65a	26236592-4ef9-45a7-9000-60df1cd8c89e	LOGIN_SUCCESS	users	\N	{"email": "crew@hams.aero"}	2026-05-01 14:19:12.162439+03	\N	\N
a33403fb-4181-4eea-b630-38d486b5b5cc	69a35569-645f-4139-944e-c21644a1685c	LOGIN_SUCCESS	users	\N	{"email": "mx@hams.aero"}	2026-05-01 14:19:12.248068+03	\N	\N
870ccb84-c746-4848-9d25-5d4effba861f	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:19:26.956347+03	\N	\N
259f2acf-7ec7-4b07-a961-72b8572e9afe	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:22:40.146191+03	\N	\N
c637f753-c009-4edc-9d10-a80dd6ea0338	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:24:11.506381+03	\N	\N
7d2402c0-7eab-4cfc-9bd3-3b4fd8f70a50	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 14:25:35.432151+03	\N	\N
8b0db843-b9ca-4d29-a0dc-3fbf7a2ffd25	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 15:01:30.142177+03	\N	\N
7af4910a-3959-43ad-af7f-694fc740006a	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 15:27:41.906682+03	\N	\N
d629b2c2-7264-474f-8181-18ec951f10da	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:02:37.312972+03	\N	\N
adde566b-b592-403c-bb91-8f3b81dadc4f	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:03:55.349128+03	\N	\N
fc61bd4c-c466-415f-89f5-aeb642f6de08	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:05:36.867997+03	\N	\N
6eae7ef6-6e70-44ac-8fd6-d14179c05ea7	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:05:58.672397+03	\N	\N
8dd77d42-07da-472e-8563-73d2bb9c73ad	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:32:35.067998+03	\N	\N
43b17f72-80f5-45b4-9775-92a6aaa19ffb	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:33:17.008304+03	\N	\N
88edc47e-d798-45cc-83da-7cc4dffa120e	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 16:34:38.159495+03	\N	\N
d03027b7-ab7f-49c0-8bb9-e9c09e2ec54e	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 20:27:49.199051+03	\N	\N
c328fd84-4bc6-4149-81ac-46c652996d01	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-01 22:35:00.496494+03	\N	\N
b4dde27f-7eb5-42c9-8608-2b92f22a18e6	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-02 16:15:20.833716+03	\N	\N
4c425e68-ec4a-4126-932a-1b30c681e8cb	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-02 16:21:22.725436+03	\N	\N
7fd6303e-dd89-4410-abe1-b07771f77fb1	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	\N	{"email": "admin@hams.aero"}	2026-05-02 16:24:30.433332+03	\N	\N
ea532b8b-ffa4-4455-a7ed-cfe8c8e88267	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 18:34:27.177694+03	\N	\N
72b7af6a-703a-47c5-9bb6-240b55e9584a	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 18:35:55.547535+03	\N	\N
0d27bd4f-a63e-485e-b1cb-ff814486f87c	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 18:45:45.455189+03	\N	\N
52354a42-d0bc-4ac6-ab8f-482b1849520e	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 20:33:45.440314+03	::ffff:127.0.0.1	curl/8.7.1
ced0ca48-d22d-48f2-9543-0ef7e31d705a	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 20:40:56.698811+03	::ffff:127.0.0.1	curl/8.7.1
5736d687-c2e0-4fb1-8583-ddb89b73c3db	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 20:55:32.760719+03	::ffff:127.0.0.1	curl/8.7.1
30ce993a-8fa0-4498-8e62-345998e36f97	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 21:02:41.324969+03	::ffff:127.0.0.1	node
32dfb821-f223-4c62-b9a4-22983b3e63dd	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 21:06:43.555227+03	::ffff:127.0.0.1	node
63750471-6e07-4154-a66e-2f4c773d62e6	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 21:15:46.605478+03	::ffff:127.0.0.1	curl/8.7.1
ff7cc7f2-a24a-4d82-906b-0b46b81abece	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 21:20:32.714006+03	::ffff:127.0.0.1	node
9fe1f2c7-296b-458c-a6db-0b7e482cb5a3	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 21:21:15.963135+03	::ffff:127.0.0.1	node
3ecef231-2216-4dcc-9e3f-9262e4b8ee4d	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-02 21:27:46.318172+03	::ffff:127.0.0.1	curl/8.7.1
9421a728-2ebe-4e4b-bd1a-7962f7e4d41d	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-03 05:21:16.524457+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
a08c5700-ae2a-4e97-be61-fb2aef047fdf	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-03 05:52:32.18453+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/3.2.16 Chrome/142.0.7444.265 Electron/39.8.1 Safari/537.36
55e5c90e-9ff7-47ad-81cc-6afa63f31f90	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-03 05:53:26.052532+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
3c13993e-0bad-4db5-ac61-eff113618583	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-03 06:28:27.759047+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
44a8c71e-6bfe-4286-98ea-f8e56261f936	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-03 06:50:26.553243+03	::ffff:127.0.0.1	curl/8.7.1
ec46f2cc-25d4-4187-88ca-d384418eb0f0	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-03 06:52:07.982246+03	::ffff:127.0.0.1	curl/8.7.1
1bd332b7-4cef-4168-9bb7-ff1dd6619512	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	FLIGHT_SCHEDULED	flights	a403a17c-be52-44bb-ac02-da680739a613	{"routeId": "7b3b9f09-1a55-4b30-b645-6981776f9952", "aircraftId": "b4b09439-d73b-4dc6-8c63-84a41e7a4cbd", "flightNumber": "HW2026"}	2026-05-03 10:27:49.626724+03	\N	\N
285e5413-08f6-43ea-966d-37dc5a755016	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_UPDATED	ops_routes	49590855-e843-479a-97ae-3dfd142310e8	{"label": "Dubai – Nairobi", "isActive": false}	2026-05-03 10:29:38.023842+03	\N	\N
80eac2d2-7b13-47c7-b230-28a8dd31092f	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_UPDATED	ops_routes	49590855-e843-479a-97ae-3dfd142310e8	{"label": "Dubai – Nairobi", "isActive": true}	2026-05-03 10:29:40.270092+03	\N	\N
c100833d-b942-4169-a8d0-b561e2131a3f	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_CREATED	ops_routes	7880afa4-aeee-4d2b-9eee-ac7a880326ed	{"dest": "NBO", "origin": "MGQ"}	2026-05-03 10:30:07.40793+03	\N	\N
7da31a13-34de-4121-9241-1d9999430f87	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_CREATED	ops_routes	d9d732c6-8653-48cf-a306-f6e5cabee34b	{"dest": "MGQ", "origin": "NBO"}	2026-05-03 10:30:25.791244+03	\N	\N
44428dfa-df2f-474c-b441-066dbd91243f	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_UPDATED	ops_routes	d9d732c6-8653-48cf-a306-f6e5cabee34b	{"label": null, "isActive": false}	2026-05-03 10:30:58.909154+03	\N	\N
12b5e255-2cf3-495c-a07e-9860eaa888fe	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_UPDATED	ops_routes	d9d732c6-8653-48cf-a306-f6e5cabee34b	{"label": null, "isActive": true}	2026-05-03 10:31:00.069469+03	\N	\N
1ea59e24-fce0-48bd-8102-96109dac349d	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_CREATED	ops_routes	badf9909-fdb4-41ec-8846-f2b24273f9e1	{"dest": "HGA", "origin": "MGQ"}	2026-05-03 10:31:37.06208+03	\N	\N
d3536215-0f4c-4d6e-948a-d73bdbd5e39b	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	OPS_ROUTE_CREATED	ops_routes	7b2b7ddd-c788-456c-a7cc-c5842731c020	{"dest": "GGR", "origin": "MGQ"}	2026-05-03 12:55:29.283453+03	\N	\N
e1535bfd-2767-4c9c-929d-c10a17a53b29	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	FLIGHT_SCHEDULED	flights	71b836ba-8c5b-464d-8d76-34631fe4a2f8	{"routeId": "7b2b7ddd-c788-456c-a7cc-c5842731c020", "aircraftId": "b4b09439-d73b-4dc6-8c63-84a41e7a4cbd", "flightNumber": "HW2027"}	2026-05-03 12:58:40.537713+03	\N	\N
11370771-942c-4d56-9bf8-8fcb1ed56a5e	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-03 13:43:48.797569+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
18512ec8-b0a0-4b93-88d6-bc3fb26fee33	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_CREATED	bookings	bb567afa-57c6-458c-8bec-3297eab03bd3	{"pnr": "Q9FC4R", "tripType": "ONE_WAY", "promoCode": null, "campaignId": null, "fareClassId": "3011d353-79c9-4a37-b363-0e3bf4c4dcc1", "inboundFlight": null, "paymentStatus": "PAID", "collectPayment": true, "outboundFlight": "HW2027", "passengerCount": 1, "baseTotalAmount": 225, "promoDiscountAmount": 0}	2026-05-03 14:26:39.147717+03	\N	\N
326a5214-1a2b-463a-9800-fcce7d8cbf25	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKETS_ISSUED	bookings	bb567afa-57c6-458c-8bec-3297eab03bd3	{"pnr": "Q9FC4R", "ticketCount": 1}	2026-05-03 14:26:53.847287+03	\N	\N
baf4586d-bceb-44f3-9e45-f12350899af8	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKETS_ISSUED	bookings	bb567afa-57c6-458c-8bec-3297eab03bd3	{"pnr": "Q9FC4R", "ticketCount": 1}	2026-05-03 14:26:55.907686+03	\N	\N
e919c1f6-facc-49d3-b557-7f23e47a7026	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKETS_ISSUED	bookings	bb567afa-57c6-458c-8bec-3297eab03bd3	{"pnr": "Q9FC4R", "ticketCount": 1}	2026-05-03 14:26:57.290835+03	\N	\N
8eecb72c-eb11-4e2b-a74e-f3b88cba88f9	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_CREATED	bookings	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	{"pnr": "YAZMZ6", "tripType": "ONE_WAY", "promoCode": null, "campaignId": null, "fareClassId": "3011d353-79c9-4a37-b363-0e3bf4c4dcc1", "inboundFlight": null, "paymentStatus": "PAID", "collectPayment": true, "outboundFlight": "HW2027", "passengerCount": 1, "baseTotalAmount": 225, "promoDiscountAmount": 0}	2026-05-03 15:09:07.725417+03	\N	\N
2add2c45-07a4-4f8c-8e08-f3cf11515006	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKETS_ISSUED	bookings	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	{"pnr": "YAZMZ6", "ticketCount": 1}	2026-05-03 15:09:13.445776+03	\N	\N
119422ef-2b02-424c-a8bd-3a925410d8af	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_CREATED	bookings	50bd8196-d0a3-455c-a198-674b99b8af44	{"pnr": "Y5SVK9", "tripType": "ONE_WAY", "promoCode": null, "campaignId": null, "fareClassId": "3011d353-79c9-4a37-b363-0e3bf4c4dcc1", "inboundFlight": null, "paymentStatus": "PAID", "collectPayment": true, "outboundFlight": "HW2027", "passengerCount": 1, "baseTotalAmount": 225, "promoDiscountAmount": 0}	2026-05-03 17:26:49.124269+03	\N	\N
acee22f2-f071-4ae6-a1fc-d68d20c0c8fb	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKETS_ISSUED	bookings	50bd8196-d0a3-455c-a198-674b99b8af44	{"pnr": "Y5SVK9", "ticketCount": 1}	2026-05-03 17:26:59.397597+03	\N	\N
078e25da-fd60-4dc7-b953-740b581a4767	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKETS_ISSUED	bookings	50bd8196-d0a3-455c-a198-674b99b8af44	{"pnr": "Y5SVK9", "ticketCount": 1}	2026-05-03 17:27:06.871176+03	\N	\N
333a89a8-eee6-42dd-a33d-78301c2b288f	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_CREATED	bookings	1e95b8ca-6511-4860-b75e-3b8bacb38de1	{"pnr": "3LCWJC", "tripType": "ONE_WAY", "promoCode": null, "campaignId": null, "fareClassId": "3011d353-79c9-4a37-b363-0e3bf4c4dcc1", "inboundFlight": null, "paymentStatus": "PAID", "collectPayment": true, "outboundFlight": "HW2027", "passengerCount": 1, "baseTotalAmount": 225, "promoDiscountAmount": 0}	2026-05-03 17:48:36.806672+03	\N	\N
657dcb53-168d-4eef-a81d-1a34515f6996	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_CREATED	bookings	6167e339-c2b1-4307-8d3c-1d3c09d802a0	{"pnr": "A32F45", "tripType": "ONE_WAY", "promoCode": null, "campaignId": null, "fareClassId": "3011d353-79c9-4a37-b363-0e3bf4c4dcc1", "inboundFlight": null, "paymentStatus": "UNPAID", "collectPayment": false, "outboundFlight": "HW2027", "passengerCount": 1, "baseTotalAmount": 225, "promoDiscountAmount": 0}	2026-05-03 18:06:37.675944+03	\N	\N
f8140f4a-3a88-4478-951c-74fec015fa5e	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_PAYMENT_RECORDED	bookings	6167e339-c2b1-4307-8d3c-1d3c09d802a0	{"amount": 225, "paymentStatus": "PAID"}	2026-05-03 18:07:42.030916+03	\N	\N
a611f4ca-a8ea-40e8-995f-fc53edab0485	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-03 22:01:18.819101+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
f95585b1-3c80-4954-9472-a0cb72674211	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-04 05:42:52.324415+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15
4304e503-760a-4547-b635-720ba5450933	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-04 19:00:13.899229+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15
b0fa057b-819e-47f2-9b0b-741d8ea58822	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-05 02:25:30.968893+03	::ffff:127.0.0.1	curl/8.7.1
5df180b7-8084-47de-b9a8-c0d1340804fd	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-05 02:27:58.729704+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15
a9114a15-3b74-4349-a896-77ce1762e43e	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-05 02:43:39.260163+03	::ffff:127.0.0.1	node
78598c5d-7048-4ef0-ac99-c60b8073caeb	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_CREATED	bookings	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	{"pnr": "NKNP9W", "tripType": "ONE_WAY", "promoCode": null, "campaignId": null, "fareClassId": "3011d353-79c9-4a37-b363-0e3bf4c4dcc1", "salesChannel": "DIRECT_WEB", "inboundFlight": null, "paymentStatus": "UNPAID", "travelAgentId": null, "collectPayment": false, "outboundFlight": "HW2027", "passengerCount": 1, "baseTotalAmount": 233, "corporateAccountId": null, "promoDiscountAmount": 0}	2026-05-05 02:49:37.818837+03	\N	\N
2296a2f8-e5d5-4626-9ae6-196a0ce07258	1ce56b41-35df-4bb6-bd91-128b158302b1	BOOKING_PAYMENT_RECORDED	bookings	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	{"amount": 233, "paymentStatus": "PAID"}	2026-05-05 02:49:57.638158+03	\N	\N
455f6ff0-313e-479e-89f3-309bfd545239	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-05 09:49:13.727448+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
685c5510-f8eb-491d-a83b-58fcf819c22f	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE_NOT_FOUND	tickets	\N	{"pnr": "NKNP9W"}	2026-05-05 09:50:19.806765+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
5e87fd40-3e1d-4e5e-803e-a4fc8a5d09b3	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE_NOT_FOUND	tickets	\N	{"pnr": "NKNP9W"}	2026-05-05 09:51:10.016587+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
fafd59c0-2ab9-4a4d-b228-671c7a77c167	1ce56b41-35df-4bb6-bd91-128b158302b1	LOGIN_SUCCESS	users	1ce56b41-35df-4bb6-bd91-128b158302b1	{"email": "admin@hawanaairways.com"}	2026-05-05 10:30:03.478359+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
cb215860-949b-4702-a120-26312d2b13cc	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE_NOT_FOUND	tickets	\N	{"pnr": "NKNP9W", "role": "super_admin", "reason": "PASSENGER_NAME_NOT_MATCHED", "lastName": "mohamud", "search_time": "2026-05-05T07:30:44.132Z", "pnrMatchedCount": 1}	2026-05-05 10:30:44.195563+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
61d73b84-631a-40bb-89c8-5b6a65c1d03c	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE_NOT_FOUND	tickets	\N	{"pnr": "NKNP9W", "role": "super_admin", "reason": "PASSENGER_NAME_NOT_MATCHED", "lastName": "mohamud", "search_time": "2026-05-05T07:32:01.617Z", "pnrMatchedCount": 1}	2026-05-05 10:32:01.634331+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
7a2e4da3-b6d3-48b6-8ee3-3634d6e9fc53	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE_NOT_FOUND	tickets	\N	{"pnr": "NKNP9W", "role": "super_admin", "reason": "PASSENGER_NAME_NOT_MATCHED", "lastName": "mohamud", "search_time": "2026-05-05T07:32:31.179Z", "pnrMatchedCount": 1}	2026-05-05 10:32:31.352835+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
aa661e91-bf03-4950-84cb-155603e398f9	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE	tickets	c9684386-3348-4072-9071-9eda1d39238f	{"pnr": "NKNP9W", "role": "super_admin", "lastName": "mohamud", "ticketIds": ["c9684386-3348-4072-9071-9eda1d39238f"], "matchCount": 1, "search_time": "2026-05-05T07:49:06.559Z"}	2026-05-05 10:49:06.632052+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
73ffe371-00ee-473f-906d-f5dfb04fc48d	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE	tickets	c9684386-3348-4072-9071-9eda1d39238f	{"pnr": "NKNP9W", "role": "super_admin", "lastName": "mohamed", "ticketIds": ["c9684386-3348-4072-9071-9eda1d39238f"], "matchCount": 1, "search_time": "2026-05-05T12:30:27.444Z"}	2026-05-05 15:30:27.470529+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
dfb0aeed-8385-4819-83bc-c402689c2b2e	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE	tickets	c9684386-3348-4072-9071-9eda1d39238f	{"pnr": "NKNP9W", "role": "super_admin", "lastName": "mohamud", "ticketIds": ["c9684386-3348-4072-9071-9eda1d39238f"], "matchCount": 1, "search_time": "2026-05-05T12:31:01.751Z"}	2026-05-05 15:31:01.757492+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
175615dd-8ad5-4358-8f3a-a8f66cd395d2	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE	tickets	c9684386-3348-4072-9071-9eda1d39238f	{"pnr": "NKNP9W", "role": "super_admin", "lastName": "mohamud", "ticketIds": ["c9684386-3348-4072-9071-9eda1d39238f"], "matchCount": 1, "search_time": "2026-05-05T13:03:12.380Z"}	2026-05-05 16:03:12.458144+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
ed6b8026-867e-4b80-9c6b-3fe87fda69b4	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE	tickets	c9684386-3348-4072-9071-9eda1d39238f	{"pnr": "NKNP9W", "role": "super_admin", "lastName": "mohamud", "ticketIds": ["c9684386-3348-4072-9071-9eda1d39238f"], "matchCount": 1, "search_time": "2026-05-05T13:15:00.969Z"}	2026-05-05 16:15:01.001933+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
7a4bc58c-0a50-4a53-ba17-a18462827769	1ce56b41-35df-4bb6-bd91-128b158302b1	TICKET_RETRIEVE	tickets	c9684386-3348-4072-9071-9eda1d39238f	{"pnr": "NKNP9W", "role": "super_admin", "lastName": "mohamud", "ticketIds": ["c9684386-3348-4072-9071-9eda1d39238f"], "matchCount": 1, "search_time": "2026-05-05T13:21:48.154Z"}	2026-05-05 16:21:48.179473+03	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36
523c1aaf-f917-41a0-8459-e465e6ac3daf	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-05 16:57:29.502304+03	::1	curl/8.7.1
0861c516-33d4-4cc3-90c5-b2e692d0a331	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	LOGIN_SUCCESS	users	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	{"email": "admin@hams.aero"}	2026-05-05 16:57:37.087111+03	::1	curl/8.7.1
\.


--
-- Data for Name: baggage; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.baggage (id, checkin_id, tag_number, weight_kg, pieces, created_at, excess_charge) FROM stdin;
\.


--
-- Data for Name: booking_flights; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.booking_flights (id, booking_id, flight_id, cabin_class, fare_amount, fare_class_id, leg_type) FROM stdin;
f24327e5-c56d-496b-a51b-fe07b077bf99	8ede22b5-6fea-4fb2-a059-03654a390c73	21f029b0-37c7-471e-9742-160de9ab72a1	ECONOMY	480.00	\N	OUTBOUND
da0641f9-68fd-4dde-96c0-ba0483d7ce1e	f2a6ce03-3ae5-4f1b-ae0e-ea76b13b0bb2	21f029b0-37c7-471e-9742-160de9ab72a1	ECONOMY	450.00	\N	OUTBOUND
9979847e-f783-4a77-be53-fbe11ab96e8f	f2a6ce03-3ae5-4f1b-ae0e-ea76b13b0bb2	e053027e-a7f6-404c-8da6-710770703e85	ECONOMY	450.00	\N	INBOUND
eb959376-96b9-4c5c-9267-1984f30484b9	43cc802d-b906-4d40-87ba-c8397035b592	21f029b0-37c7-471e-9742-160de9ab72a1	ECONOMY	800.00	\N	OUTBOUND
7ffe7615-b469-495e-bfbc-0ab901e5a907	03ec9c3a-4250-4793-a02d-02c179ebca5d	21f029b0-37c7-471e-9742-160de9ab72a1	ECONOMY	1200.00	\N	OUTBOUND
f15f1516-db1b-4bbe-8683-ac82431e847f	bb567afa-57c6-458c-8bec-3297eab03bd3	71b836ba-8c5b-464d-8d76-34631fe4a2f8	ECONOMY	200.00	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	OUTBOUND
a5138c11-bc40-4aee-b814-a535e69e9c5f	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	71b836ba-8c5b-464d-8d76-34631fe4a2f8	ECONOMY	200.00	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	OUTBOUND
27bb0a25-344f-4518-bdc9-fe9103f5369a	50bd8196-d0a3-455c-a198-674b99b8af44	71b836ba-8c5b-464d-8d76-34631fe4a2f8	ECONOMY	200.00	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	OUTBOUND
0ed6cb28-f7bc-4621-aa25-9313360a3473	1e95b8ca-6511-4860-b75e-3b8bacb38de1	71b836ba-8c5b-464d-8d76-34631fe4a2f8	ECONOMY	200.00	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	OUTBOUND
4eff885b-c8f5-49b7-8c57-c25b4e8babeb	6167e339-c2b1-4307-8d3c-1d3c09d802a0	71b836ba-8c5b-464d-8d76-34631fe4a2f8	ECONOMY	200.00	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	OUTBOUND
804899b4-2f30-45b9-9e22-f5b0afcccc26	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	71b836ba-8c5b-464d-8d76-34631fe4a2f8	ECONOMY	200.00	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	OUTBOUND
\.


--
-- Data for Name: booking_passengers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.booking_passengers (id, booking_id, passenger_id, passenger_type) FROM stdin;
b6460098-7f5e-47be-94c7-3394c94407d1	8ede22b5-6fea-4fb2-a059-03654a390c73	f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	ADT
ff10efa2-890a-4d27-9a4b-ee90f10d059a	f2a6ce03-3ae5-4f1b-ae0e-ea76b13b0bb2	910ede1b-98c2-4e79-b9b2-7186040b58f2	ADT
fc26017e-47d3-4756-b5f9-29f6328f97e2	43cc802d-b906-4d40-87ba-c8397035b592	074d4b05-6b05-458e-949c-4adea3eb6d14	ADT
13328b0e-c7b1-4813-8828-3c132befc63d	03ec9c3a-4250-4793-a02d-02c179ebca5d	074d4b05-6b05-458e-949c-4adea3eb6d14	ADT
3290fe65-2108-4b8c-b9b2-063de56e7688	bb567afa-57c6-458c-8bec-3297eab03bd3	9372495a-a456-4741-a6dd-0bf6ad92bede	ADT
3a810766-7f98-41d4-aedc-f1b0fc975936	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	2cec3acd-e5f2-4cc3-8973-e876ecd5db4e	ADT
cfd72ed1-ac2b-46d1-b529-c9631bc99590	50bd8196-d0a3-455c-a198-674b99b8af44	6f739dce-a9b6-45e3-8a97-9ebf9ca4a333	ADT
1b71cd85-050d-4a8d-8439-09e8915cb83c	1e95b8ca-6511-4860-b75e-3b8bacb38de1	35c23981-46c2-4d45-9dbf-9417b956140f	ADT
82981974-e1a7-4161-bf21-d5b1e559b27f	6167e339-c2b1-4307-8d3c-1d3c09d802a0	58246216-90af-44e7-a2b0-d9f79c7669b5	ADT
8f7d3d10-fc98-4cc3-94c3-6947eb9b8bcd	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	33be4b60-c6ea-4d1e-b159-e0e810b560e2	ADT
\.


--
-- Data for Name: bookings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.bookings (id, pnr, booking_status, total_amount, currency, created_by, created_at, payment_status, notes, promo_code_id, campaign_id, promo_discount_amount, return_date, fare_breakdown, fare_base_total, fare_tax_total, fare_fee_total, trip_type, sales_channel_code, corporate_account_id, travel_agent_id) FROM stdin;
43cc802d-b906-4d40-87ba-c8397035b592	FNSEED1	CONFIRMED	800.00	USD	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 21:20:08.76077+03	UNPAID	\N	\N	cd644e30-6021-4ab4-aa56-318470732a6e	0.00	\N	\N	\N	\N	\N	ONE_WAY	DIRECT_WEB	\N	\N
03ec9c3a-4250-4793-a02d-02c179ebca5d	FNSEED2	CONFIRMED	1200.00	USD	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 21:20:08.777199+03	PAID	\N	\N	cd644e30-6021-4ab4-aa56-318470732a6e	0.00	\N	\N	\N	\N	\N	ONE_WAY	DIRECT_WEB	\N	\N
d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	YAZMZ6	CONFIRMED	225.00	USD	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 15:09:07.725417+03	PAID	\N	\N	\N	0.00	\N	{"lines": [{"code": "BASE_OUT", "label": "Outbound base fare", "amount": 200}, {"code": "VAT", "type": "tax", "label": "Value added tax", "amount": 10, "applies": "SUBTOTAL"}, {"code": "YQ", "type": "fee", "label": "Carrier fuel surcharge", "amount": 15}], "total": 225, "version": 1, "currency": "USD", "tripType": "ONE_WAY", "promoDiscount": 0, "passengerCount": 1, "totalPerPassenger": 225, "inboundPerPassenger": 0, "subtotalBeforePromo": 225, "outboundPerPassenger": 200}	200.00	10.00	15.00	ONE_WAY	DIRECT_WEB	\N	\N
1e95b8ca-6511-4860-b75e-3b8bacb38de1	3LCWJC	CONFIRMED	225.00	USD	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:48:36.806672+03	PAID	\N	\N	\N	0.00	\N	{"lines": [{"code": "BASE_OUT", "label": "Outbound base fare", "amount": 200}, {"code": "VAT", "type": "tax", "label": "Value added tax", "amount": 10, "applies": "SUBTOTAL"}, {"code": "YQ", "type": "fee", "label": "Carrier fuel surcharge", "amount": 15}], "total": 225, "version": 1, "currency": "USD", "tripType": "ONE_WAY", "promoDiscount": 0, "passengerCount": 1, "totalPerPassenger": 225, "inboundPerPassenger": 0, "subtotalBeforePromo": 225, "outboundPerPassenger": 200}	200.00	10.00	15.00	ONE_WAY	DIRECT_WEB	\N	\N
bb567afa-57c6-458c-8bec-3297eab03bd3	Q9FC4R	CONFIRMED	225.00	USD	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 14:26:39.147717+03	PAID	\N	\N	\N	0.00	\N	{"lines": [{"code": "BASE_OUT", "label": "Outbound base fare", "amount": 200}, {"code": "VAT", "type": "tax", "label": "Value added tax", "amount": 10, "applies": "SUBTOTAL"}, {"code": "YQ", "type": "fee", "label": "Carrier fuel surcharge", "amount": 15}], "total": 225, "version": 1, "currency": "USD", "tripType": "ONE_WAY", "promoDiscount": 0, "passengerCount": 1, "totalPerPassenger": 225, "inboundPerPassenger": 0, "subtotalBeforePromo": 225, "outboundPerPassenger": 200}	200.00	10.00	15.00	ONE_WAY	DIRECT_WEB	\N	\N
50bd8196-d0a3-455c-a198-674b99b8af44	Y5SVK9	CONFIRMED	225.00	USD	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:26:49.124269+03	PAID	\N	\N	\N	0.00	\N	{"lines": [{"code": "BASE_OUT", "label": "Outbound base fare", "amount": 200}, {"code": "VAT", "type": "tax", "label": "Value added tax", "amount": 10, "applies": "SUBTOTAL"}, {"code": "YQ", "type": "fee", "label": "Carrier fuel surcharge", "amount": 15}], "total": 225, "version": 1, "currency": "USD", "tripType": "ONE_WAY", "promoDiscount": 0, "passengerCount": 1, "totalPerPassenger": 225, "inboundPerPassenger": 0, "subtotalBeforePromo": 225, "outboundPerPassenger": 200}	200.00	10.00	15.00	ONE_WAY	DIRECT_WEB	\N	\N
6167e339-c2b1-4307-8d3c-1d3c09d802a0	A32F45	CONFIRMED	225.00	USD	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 18:06:37.675944+03	PAID	\N	\N	\N	0.00	\N	{"lines": [{"code": "BASE_OUT", "label": "Outbound base fare", "amount": 200}, {"code": "VAT", "type": "tax", "label": "Value added tax", "amount": 10, "applies": "SUBTOTAL"}, {"code": "YQ", "type": "fee", "label": "Carrier fuel surcharge", "amount": 15}], "total": 225, "version": 1, "currency": "USD", "tripType": "ONE_WAY", "promoDiscount": 0, "passengerCount": 1, "totalPerPassenger": 225, "inboundPerPassenger": 0, "subtotalBeforePromo": 225, "outboundPerPassenger": 200}	200.00	10.00	15.00	ONE_WAY	DIRECT_WEB	\N	\N
8ede22b5-6fea-4fb2-a059-03654a390c73	BKTOW1	CONFIRMED	520.00	USD	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 23:36:37.301931+03	PAID	Seed: one-way booking with full graph.	\N	\N	0.00	\N	{"fees": 15, "lines": [{"code": "BASE", "label": "Base fare", "amount": 480}, {"code": "TAX", "label": "Taxes", "amount": 25}, {"code": "FEE", "label": "Fees", "amount": 15}], "taxes": 25, "total": 520, "version": 1, "baseSubtotal": 480, "promoDiscount": 0}	480.00	25.00	15.00	ONE_WAY	DIRECT_WEB	\N	\N
f2a6ce03-3ae5-4f1b-ae0e-ea76b13b0bb2	BKTRTN1	CONFIRMED	980.00	USD	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 23:36:37.309017+03	PENDING	Seed: return trip — payment pending for workflow demo.	\N	\N	0.00	2026-05-04	{"fees": 30, "lines": [{"code": "BASE_OUT", "label": "Outbound base", "amount": 450}, {"code": "BASE_IN", "label": "Inbound base", "amount": 450}, {"code": "TAX", "label": "Taxes", "amount": 50}, {"code": "FEE", "label": "Fees", "amount": 30}], "taxes": 50, "total": 980, "version": 1, "baseSubtotal": 900, "promoDiscount": 0}	900.00	50.00	30.00	RETURN	DIRECT_WEB	\N	\N
c2d02bac-8a2c-44e8-a9a8-426a90d26cca	NKNP9W	CONFIRMED	233.00	USD	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-05 02:49:37.818837+03	PAID	\N	\N	\N	0.00	\N	{"lines": [{"code": "BASE_OUT", "label": "Outbound base fare", "amount": 200}, {"code": "VAT", "type": "tax", "label": "Value added tax", "amount": 10, "applies": "SUBTOTAL"}, {"code": "PSF", "type": "fee", "label": "Passenger service charge", "amount": 8}, {"code": "YQ", "type": "fee", "label": "Carrier fuel surcharge", "amount": 15}], "total": 233, "version": 1, "currency": "USD", "tripType": "ONE_WAY", "promoDiscount": 0, "passengerCount": 1, "totalPerPassenger": 233, "inboundPerPassenger": 0, "subtotalBeforePromo": 233, "outboundPerPassenger": 200}	200.00	10.00	23.00	ONE_WAY	DIRECT_WEB	\N	\N
\.


--
-- Data for Name: checkins; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.checkins (id, booking_id, passenger_id, flight_id, seat_number, checkin_time, checked_in_by, boarding_pass_no, boarding_status, checkin_status, boarded_at, boarding_gate, boarding_sequence) FROM stdin;
b5440120-605b-4e04-8a8d-e8d746d03859	8ede22b5-6fea-4fb2-a059-03654a390c73	f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	21f029b0-37c7-471e-9742-160de9ab72a1	12A	2026-05-03 06:13:38.074858+03	\N	BPDEMOBKTOW101	CHECKED_IN	COMPLETED	\N	\N	\N
\.


--
-- Data for Name: crew_assignments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_assignments (id, flight_id, crew_user_id, duty_role, assigned_at) FROM stdin;
37d9ffa3-0ce7-4fe6-b9f4-1c6dddbffc30	21f029b0-37c7-471e-9742-160de9ab72a1	26236592-4ef9-45a7-9000-60df1cd8c89e	Captain	2026-05-02 21:02:27.231639+03
077464c8-cf5f-4496-9a72-32e15864472e	e053027e-a7f6-404c-8da6-710770703e85	26236592-4ef9-45a7-9000-60df1cd8c89e	FO	2026-05-02 21:02:27.234492+03
\.


--
-- Data for Name: crew_availability; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_availability (id, user_id, period_start, period_end, status, reason, created_at) FROM stdin;
\.


--
-- Data for Name: crew_documents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_documents (id, user_id, doc_type, title, reference_number, issue_date, expiry_date, storage_url, created_at) FROM stdin;
\.


--
-- Data for Name: crew_duty_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_duty_logs (id, user_id, flight_id, duty_start, duty_end, rest_until, duty_minutes, created_at) FROM stdin;
\.


--
-- Data for Name: crew_licenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_licenses (id, user_id, license_type, license_number, issuing_authority, issue_date, expiry_date, is_active, created_at) FROM stdin;
813bc1f0-b868-4be4-a325-494ae36f9891	26236592-4ef9-45a7-9000-60df1cd8c89e	ATPL	ATP-DEMO-1	KCAA	2025-03-28	2026-05-27	t	2026-05-02 21:02:27.235769+03
\.


--
-- Data for Name: crew_medicals; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_medicals (id, user_id, medical_class, expiry_date, examiner_name, is_active, created_at) FROM stdin;
5cb2ec0c-040f-445d-9c72-9fd0e4224a74	26236592-4ef9-45a7-9000-60df1cd8c89e	Class 1	2026-05-14	Aviation Medical Center	t	2026-05-02 21:02:27.236921+03
\.


--
-- Data for Name: crew_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_profiles (user_id, crew_category, employee_number, base_airport, phone, emergency_contact, hire_date, notes, created_at, updated_at) FROM stdin;
26236592-4ef9-45a7-9000-60df1cd8c89e	PILOT	EMP-26236592	NBO	\N	\N	2026-05-02	Auto-seeded profile for crew management demo.	2026-05-02 21:02:27.227094+03	2026-05-02 21:04:19.504018+03
\.


--
-- Data for Name: crew_training; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.crew_training (id, user_id, training_code, title, completed_date, expiry_date, instructor, created_at) FROM stdin;
1eae03fa-e3af-4685-a501-73505c5fbc13	26236592-4ef9-45a7-9000-60df1cd8c89e	CABIN_SAFETY	Cabin safety recurrent	2026-04-02	2027-02-26	Training Dept	2026-05-02 21:02:27.23744+03
\.


--
-- Data for Name: cs_case_notes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cs_case_notes (id, case_id, body, is_internal, created_by, created_at) FROM stdin;
d723f2a1-52bd-49ae-953b-b0bd47624663	5c08532c-4dea-4d4f-a167-8b3817d9bdf6	Internal: initial triage — passenger prefers email follow-up.	t	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 05:38:19.652996+03
\.


--
-- Data for Name: cs_customer_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cs_customer_profiles (passenger_id, preferred_language, vip_flag, service_notes, preferred_contact, updated_at) FROM stdin;
\.


--
-- Data for Name: cs_service_cases; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cs_service_cases (id, case_ref, case_type, status, priority, passenger_id, booking_id, baggage_id, refund_request_id, subject, description, metadata, assigned_to, created_by, created_at, updated_at, closed_at) FROM stdin;
5c08532c-4dea-4d4f-a167-8b3817d9bdf6	CS-DEMO-OPEN1	COMPLAINT	OPEN	HIGH	f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	8ede22b5-6fea-4fb2-a059-03654a390c73	\N	\N	Demo: onboard service feedback	Seeded complaint linked to booking for CS dashboard and history tests.	\N	\N	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 05:38:19.644161+03	2026-05-03 05:38:19.644161+03	\N
0b46e4c5-6e18-4a74-a6b9-7ff2841c5349	CS-DEMO-PEND1	SUPPORT	IN_PROGRESS	NORMAL	910ede1b-98c2-4e79-b9b2-7186040b58f2	f2a6ce03-3ae5-4f1b-ae0e-ea76b13b0bb2	\N	\N	Demo: schedule change inquiry	Seeded in-progress case tied to booking.	\N	\N	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 05:38:19.651106+03	2026-05-03 05:38:19.651106+03	\N
08179419-86b3-4f36-9608-684c9374e4d2	CS-DEMO-RES1	GENERAL	RESOLVED	LOW	f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	8ede22b5-6fea-4fb2-a059-03654a390c73	\N	\N	Demo: resolved baggage question	Seeded resolved case for metrics.	\N	\N	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 05:38:19.652191+03	2026-05-03 05:38:19.652191+03	2026-05-03 05:38:19.652191+03
\.


--
-- Data for Name: dispatch_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.dispatch_logs (id, flight_id, dispatch_status, remarks, dispatched_by, dispatched_at, checklist_json) FROM stdin;
\.


--
-- Data for Name: finance_expenses; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.finance_expenses (id, category, amount, currency, incurred_on, description, reference, flight_id, entered_by, created_at) FROM stdin;
2761407b-328f-43e5-8e53-a802d22fe6a9	GROUND_HANDLING	1250.00	USD	2026-05-03	Seed: ramp and handling (MTD)	SEED-FIN-EXP	\N	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 21:20:08.778863+03
\.


--
-- Data for Name: finance_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.finance_transactions (id, txn_type, amount, currency, booking_id, payment_id, refund_id, refund_request_id, expense_id, description, metadata, created_by, created_at) FROM stdin;
aee070cb-a942-44ba-87c0-0f635d714dd0	PAYMENT_RECORDED	225.00	USD	bb567afa-57c6-458c-8bec-3297eab03bd3	46803e40-2c6f-4fe6-bf6f-63f4d0d60290	\N	\N	\N	Payment at booking creation	{"source": "booking_create"}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 14:26:39.147717+03
6aafa559-197d-48b5-bc42-023221fcfe90	TICKET_ISSUED	\N	USD	bb567afa-57c6-458c-8bec-3297eab03bd3	\N	\N	\N	\N	Issued 1 ticket(s) for PNR Q9FC4R	{"pnr": "Q9FC4R", "newlyIssued": 1}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 14:26:39.147717+03
9c534baf-c624-4957-adc0-207ede914954	PAYMENT_RECORDED	225.00	USD	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	dd7e6feb-7c98-467d-b24a-07d99d31b01b	\N	\N	\N	Payment at booking creation	{"source": "booking_create"}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 15:09:07.725417+03
2b857880-3f75-49f8-acfd-a691dc9a1fc5	TICKET_ISSUED	\N	USD	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	\N	\N	\N	\N	Issued 1 ticket(s) for PNR YAZMZ6	{"pnr": "YAZMZ6", "newlyIssued": 1}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 15:09:07.725417+03
1c5abdda-e6f4-4eac-b7ad-5ccfe525abf7	PAYMENT_RECORDED	225.00	USD	50bd8196-d0a3-455c-a198-674b99b8af44	ae907fe5-36ad-4dbd-b455-befb8028b478	\N	\N	\N	Payment at booking creation	{"source": "booking_create"}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:26:49.124269+03
09c368e3-41c8-4ff3-b75f-0d3d36175084	TICKET_ISSUED	\N	USD	50bd8196-d0a3-455c-a198-674b99b8af44	\N	\N	\N	\N	Issued 1 ticket(s) for PNR Y5SVK9	{"pnr": "Y5SVK9", "newlyIssued": 1}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:26:49.124269+03
9d2d1ff5-7f64-4372-a2d3-0c855d6a1783	PAYMENT_RECORDED	225.00	USD	1e95b8ca-6511-4860-b75e-3b8bacb38de1	b841a23e-05d0-4175-95f1-c2449260ca0b	\N	\N	\N	Payment at booking creation	{"source": "booking_create"}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:48:36.806672+03
4d26a58e-3d38-4a0f-9207-9d0aa5988f51	TICKET_ISSUED	\N	USD	1e95b8ca-6511-4860-b75e-3b8bacb38de1	\N	\N	\N	\N	Issued 1 ticket(s) for PNR 3LCWJC	{"pnr": "3LCWJC", "newlyIssued": 1}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:48:36.806672+03
ac47eca8-ba38-48ce-bc65-25848ac31bc4	PAYMENT_RECORDED	225.00	USD	6167e339-c2b1-4307-8d3c-1d3c09d802a0	aa24a0ca-e5b0-4c17-aec2-d609846e0d16	\N	\N	\N	Manual payment (PAID)	{"paymentType": "CARD"}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 18:07:42.030916+03
1f796562-70ae-4d5c-8727-d2aa863564b9	TICKET_ISSUED	\N	USD	6167e339-c2b1-4307-8d3c-1d3c09d802a0	\N	\N	\N	\N	Issued 1 ticket(s) for PNR A32F45	{"pnr": "A32F45", "newlyIssued": 1}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 18:07:42.030916+03
21274c46-de5e-4373-8373-9680783bb3c8	PAYMENT_RECORDED	233.00	USD	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	b93687c3-6b82-424e-93fe-9710510e7e83	\N	\N	\N	Manual payment (PAID)	{"paymentType": "CARD"}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-05 02:49:57.638158+03
8ebc6cf1-7431-4974-8b10-c50e05cdf6bd	TICKET_ISSUED	\N	USD	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	\N	\N	\N	\N	Issued 1 ticket(s) for PNR NKNP9W	{"pnr": "NKNP9W", "newlyIssued": 1}	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-05 02:49:57.638158+03
\.


--
-- Data for Name: flight_delays; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.flight_delays (id, flight_id, delay_minutes, reason, reported_by, created_at, revised_departure, operational_notes) FROM stdin;
\.


--
-- Data for Name: flights; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.flights (id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, status, aircraft_id, created_by, created_at, route_id, cancellation_reason, cancelled_at, gate, boarding_time, checkin_closed_at, checkin_closed_by) FROM stdin;
76360b5a-f9b4-4603-b5f5-238fc3789baa	HWT202605021	NBO	DXB	2026-05-02 09:30:00+03	2026-05-02 16:15:00+03	SCHEDULED	470e62a2-5aa1-44e1-8b8c-9c4133923397	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 22:14:44.488898+03	f65f96d2-2137-43aa-992f-85c70a0a778a	\N	\N	A12	2026-05-02 08:45:00+03	\N	\N
d0afe56d-205c-492e-8ee5-62c1a13166da	HWT202605022	DXB	NBO	2026-05-02 18:00:00+03	2026-05-03 00:30:00+03	BOARDING	b4b09439-d73b-4dc6-8c63-84a41e7a4cbd	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 22:14:44.490879+03	49590855-e843-479a-97ae-3dfd142310e8	\N	\N	B04	2026-05-02 17:15:00+03	\N	\N
2d07c6a0-deaf-4e72-9b8b-7a4d03167db6	HWT202605031	NBO	DXB	2026-05-03 09:30:00+03	2026-05-03 16:15:00+03	SCHEDULED	470e62a2-5aa1-44e1-8b8c-9c4133923397	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 05:38:19.399766+03	f65f96d2-2137-43aa-992f-85c70a0a778a	\N	\N	A12	2026-05-03 08:45:00+03	\N	\N
32327bda-4b60-4cbf-95f9-6ee87be5846e	HWT202605032	DXB	NBO	2026-05-03 18:00:00+03	2026-05-04 00:30:00+03	BOARDING	b4b09439-d73b-4dc6-8c63-84a41e7a4cbd	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 05:38:19.401735+03	49590855-e843-479a-97ae-3dfd142310e8	\N	\N	B04	2026-05-03 17:15:00+03	\N	\N
a403a17c-be52-44bb-ac02-da680739a613	HW2026	MGQ	JIB	2026-05-04 11:27:00+03	2026-05-04 12:30:00+03	SCHEDULED	b4b09439-d73b-4dc6-8c63-84a41e7a4cbd	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 10:27:49.626724+03	7b3b9f09-1a55-4b30-b645-6981776f9952	\N	\N	\N	2026-05-03 10:27:00+03	\N	\N
71b836ba-8c5b-464d-8d76-34631fe4a2f8	HW2027	MGQ	GGR	2026-05-09 12:05:00+03	2026-05-09 13:45:00+03	SCHEDULED	b4b09439-d73b-4dc6-8c63-84a41e7a4cbd	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-03 12:58:40.537713+03	7b2b7ddd-c788-456c-a7cc-c5842731c020	\N	\N	GATE 13	2026-05-09 20:45:00+03	\N	\N
21f029b0-37c7-471e-9742-160de9ab72a1	HW101	DXB	NBO	2026-05-04 06:00:00+03	2026-05-04 11:00:00+03	CHECKIN_OPEN	470e62a2-5aa1-44e1-8b8c-9c4133923397	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-01 13:38:26.390492+03	49590855-e843-479a-97ae-3dfd142310e8	\N	\N	\N	\N	\N	\N
e053027e-a7f6-404c-8da6-710770703e85	HW205	NBO	DXB	2026-05-05 07:00:00+03	2026-05-05 12:00:00+03	CHECKIN_OPEN	b4b09439-d73b-4dc6-8c63-84a41e7a4cbd	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-01 13:38:26.391892+03	f65f96d2-2137-43aa-992f-85c70a0a778a	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: login_history; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.login_history (id, user_id, email, success, ip_address, user_agent, reason, created_at) FROM stdin;
8565dab1-f49f-4f4b-8386-281c0e57ace6	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-02 20:33:45.435083+03
01d08d1b-7315-4739-9979-844ef5198b2e	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-02 20:40:56.694323+03
43ac7947-1143-4b0a-b5a5-8301088c6536	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-02 20:55:32.75503+03
9614cd0f-79ed-4e30-86fc-b75d1ac5dbf8	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	node	\N	2026-05-02 21:02:41.320936+03
5191713c-6ea2-4d54-a134-2a17be356919	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	node	\N	2026-05-02 21:06:43.550932+03
221cf744-a986-48f5-8fef-fd77d5453ed1	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-02 21:15:46.602322+03
6454f98d-4da0-4f65-9cb7-6d9488160b62	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	node	\N	2026-05-02 21:20:32.710078+03
ea97e286-433c-46f0-b7e6-e120442c84f1	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	node	\N	2026-05-02 21:21:15.959679+03
6d05fe54-817b-4222-9958-ce9098f87ac4	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-02 21:27:46.3134+03
8d0b4381-f978-43d0-8a81-96891b5b3991	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-03 05:21:16.492497+03
c1eeaaa4-9fcc-4616-ba46-e668c15a0fed	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Cursor/3.2.16 Chrome/142.0.7444.265 Electron/39.8.1 Safari/537.36	\N	2026-05-03 05:52:32.18021+03
870e0d2a-db2b-4ea7-8416-aa2518674c4c	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-03 05:53:26.048272+03
d7153851-f33a-4a3b-8a99-1caeb32ece3f	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-03 06:28:27.752972+03
49852897-8634-4171-b4b9-c7f47aa66f26	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-03 06:50:26.54817+03
b741251a-ade4-45dc-9a6c-d66a0e3a0203	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-03 06:52:07.9767+03
43b7fb45-49b0-421a-a70f-7e695ba4c63c	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-03 13:43:48.789648+03
ece6319c-ce23-459b-82d3-778c9a65557d	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-03 22:01:18.807909+03
3359b158-d33b-4d47-93e8-de2afcae250f	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15	\N	2026-05-04 05:42:52.293968+03
e5561e8f-77fd-4003-ab5f-241a7cf2eb30	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15	\N	2026-05-04 19:00:13.883069+03
344ea84f-869e-41cd-8a39-efb2d90800fa	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::ffff:127.0.0.1	curl/8.7.1	\N	2026-05-05 02:25:30.964765+03
4a99dbc8-b7ba-46d6-b552-78a61da665d6	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15	\N	2026-05-05 02:27:58.726164+03
d21df0f0-a1fe-416a-a596-94ed0ab11d35	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::ffff:127.0.0.1	node	\N	2026-05-05 02:43:39.25448+03
024af331-8262-4a4b-a3af-2980907f9583	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-05 09:49:13.684004+03
a1e95ef8-ec95-4f3d-b6e3-3f145bee7061	1ce56b41-35df-4bb6-bd91-128b158302b1	admin@hawanaairways.com	t	::1	Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36	\N	2026-05-05 10:30:03.46838+03
352aba1f-368f-4421-8bc1-50304cd87608	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::1	curl/8.7.1	\N	2026-05-05 16:57:29.474776+03
748e2342-306d-44a1-a2bd-ed1bbf068428	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	admin@hams.aero	t	::1	curl/8.7.1	\N	2026-05-05 16:57:37.08387+03
\.


--
-- Data for Name: maintenance_inspections; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.maintenance_inspections (id, aircraft_id, inspection_type, scheduled_for, status, remarks, scheduled_by, completed_by, completed_at, created_at) FROM stdin;
\.


--
-- Data for Name: maintenance_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.maintenance_logs (id, aircraft_id, defect_code, defect_description, severity, status, opened_by, closed_by, opened_at, closed_at) FROM stdin;
\.


--
-- Data for Name: md_aircraft_types; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_aircraft_types (id, code, name, default_seat_capacity, is_active, created_at) FROM stdin;
7f5db2aa-5481-4ffd-a576-1193a8cef33c	B738	Boeing 737-800	162	t	2026-05-02 20:27:07.634375+03
a731158d-8b95-4cad-a648-ee5279482c24	A320	Airbus A320	150	t	2026-05-02 20:27:07.634375+03
7c1f9e6a-f851-48c7-9d72-6c2ed23d738b	E190	ERJ190	110	t	2026-05-04 05:51:49.668241+03
\.


--
-- Data for Name: md_airports; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_airports (id, iata_code, name, country_id, city_id, timezone, is_active, created_at) FROM stdin;
a16dcec2-09dc-4654-be26-8ca22725c8dc	DXB	Dubai International	2cdc869c-ffa1-46c8-bb9b-dcfc03c4f455	\N	Asia/Dubai	t	2026-05-02 20:27:07.631246+03
4fd4ccb0-4d9e-42ed-b338-558287076f51	NBO	Jomo Kenyatta International	ede277a6-4be0-40c2-99f0-0726cee5e23c	\N	Africa/Nairobi	t	2026-05-02 20:27:07.633981+03
45386a7e-08b5-4b58-946f-eaf29921a987	MGQ	Aden Adde international Airport	\N	\N	UTC+3	t	2026-05-03 13:48:39.194074+03
1c06c87f-6165-4c5f-b387-94164996d65d	GGR	Mohamed Abshir internaional Airport	\N	\N	UTC+3	t	2026-05-03 13:49:32.602385+03
13f052d9-d026-48f5-962f-52b7dbfc972f	JIB	Djibouti–Ambouli International	95a8c675-842c-4b4d-a633-2d7f4acbb162	\N	Africa/Djibouti	t	2026-05-03 20:45:57.402567+03
14873603-bd35-460b-80ea-0861aee2455a	HGA	HGA Airport	\N	\N	UTC	t	2026-05-03 20:45:57.526735+03
\.


--
-- Data for Name: md_baggage_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_baggage_rules (id, route_id, fare_class_id, free_pieces, free_weight_kg, max_weight_per_piece_kg, charge_per_kg_over, currency, is_active, created_at) FROM stdin;
6de4e611-ed46-4917-8051-0d8a53d18b08	0ce8b29a-6c5a-480c-9279-de8b18dc42fa	\N	1	23.00	32.00	12.00	USD	t	2026-05-02 20:27:07.643904+03
ea7ba333-799b-4d3d-9fe5-5692bb4fca50	55682a87-07f6-4998-a3c6-9a88e17ea0c3	\N	1	23.00	32.00	12.00	USD	t	2026-05-02 20:27:07.643904+03
f53d6348-cbc0-4831-b75b-249537336d79	87829a9f-9589-4cda-9333-e9a45216069a	\N	1	23.00	32.00	12.00	USD	t	2026-05-03 20:45:57.416155+03
ab5f7a6e-af1c-4599-8333-e7d0abcaca36	d375a96b-e947-491e-8953-f593418cd996	\N	1	23.00	32.00	12.00	USD	t	2026-05-03 20:45:57.416155+03
b7fd69c8-8fc2-455f-9572-fdf4802630a3	10405ec7-1472-46f6-a6e0-0a2ad971e36b	\N	1	23.00	32.00	12.00	USD	t	2026-05-03 20:45:57.416155+03
b76e8d76-3c60-4880-a05d-11074c250fec	0ce8b29a-6c5a-480c-9279-de8b18dc42fa	49e4471f-9114-429b-bc06-0a3e57ba9a89	1	23.00	32.00	15.00	USD	t	2026-05-04 05:58:40.709961+03
0140213e-37c8-453a-9961-0033c5720cd6	87829a9f-9589-4cda-9333-e9a45216069a	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	1	30.00	32.00	15.00	USD	t	2026-05-04 05:59:08.645308+03
3d98284f-9b2c-4027-ba43-a6f62a67aa2c	\N	985fb8ba-9706-4a61-9147-900777f90d26	1	40.00	32.00	15.00	USD	t	2026-05-04 05:59:26.738243+03
18c37632-7fb8-4a54-9e58-cb76e48a9a7d	\N	67f75463-2c18-49ac-9e78-76f4ebffd783	1	25.00	32.00	15.00	USD	t	2026-05-04 06:00:00.985829+03
\.


--
-- Data for Name: md_cities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_cities (id, country_id, name, iata_code, is_active, created_at) FROM stdin;
88b332df-5ed7-4c99-99ce-3e2dc767c3b9	2cdc869c-ffa1-46c8-bb9b-dcfc03c4f455	Dubai	\N	t	2026-05-02 20:28:38.953091+03
ca65a8a5-7d00-425a-9be4-8d74d436f52a	ede277a6-4be0-40c2-99f0-0726cee5e23c	Nairobi	\N	t	2026-05-02 20:28:38.954806+03
\.


--
-- Data for Name: md_countries; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_countries (id, iso2, name, is_active, created_at) FROM stdin;
2cdc869c-ffa1-46c8-bb9b-dcfc03c4f455	AE	United Arab Emirates	t	2026-05-02 20:27:07.618687+03
ede277a6-4be0-40c2-99f0-0726cee5e23c	KE	Kenya	t	2026-05-02 20:27:07.618687+03
7748a6db-1709-4c46-9129-06ec37ed69e0	SO	Somalia	t	2026-05-03 14:11:29.14819+03
0b22c4ad-827a-4f08-912d-badb22d75c8a	ET	Ethiopia	t	2026-05-03 14:11:45.473286+03
95a8c675-842c-4b4d-a633-2d7f4acbb162	DJ	Djibouti	t	2026-05-03 20:45:57.395123+03
\.


--
-- Data for Name: md_currencies; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_currencies (id, code, name, decimal_places, is_active, created_at) FROM stdin;
9f86d371-c259-4d3b-92b3-a06447851e19	USD	US Dollar	2	t	2026-05-02 20:27:07.630657+03
47be26fb-06ea-4b54-bda5-a8f9005f3978	KES	Kenyan Shilling	2	t	2026-05-02 20:27:07.630657+03
\.


--
-- Data for Name: md_departments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_departments (id, code, name, parent_id, is_active, created_at) FROM stdin;
92f09aac-dd4d-466d-9923-a91df72eae29	OPS	Operations	\N	t	2026-05-02 20:27:07.644516+03
8ac83a21-3fb6-4518-bb98-784eb1981df9	COMM	Commercial	\N	t	2026-05-02 20:27:07.644516+03
\.


--
-- Data for Name: md_fare_classes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_fare_classes (id, code, name, booking_class, description, is_active, created_at) FROM stdin;
49e4471f-9114-429b-bc06-0a3e57ba9a89	ECON	Economy Saver	ECONOMY	Default economy	t	2026-05-02 20:27:07.636462+03
67f75463-2c18-49ac-9e78-76f4ebffd783	FLEX	Economy Flex	ECONOMY	Flexible economy	t	2026-05-02 20:27:07.636462+03
3011d353-79c9-4a37-b363-0e3bf4c4dcc1	Y	Economy Standard	ECONOMY	\N	t	2026-05-03 13:54:29.579128+03
985fb8ba-9706-4a61-9147-900777f90d26	BUS	Business	BUSINESS	Business cabin	t	2026-05-03 20:45:57.40651+03
\.


--
-- Data for Name: md_fee_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_fee_settings (id, code, name, amount_fixed, rate_percent, is_active, created_at) FROM stdin;
93f281bb-66cf-486c-988c-da4e010ec90f	YQ	Carrier fuel surcharge	15.00	0.0000	t	2026-05-02 20:27:07.642693+03
b731c4ee-5647-4a91-998a-b8808ddcbede	PSF	Passenger service charge	8.00	0.0000	t	2026-05-03 20:45:57.41529+03
\.


--
-- Data for Name: md_payment_methods; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_payment_methods (id, code, name, is_active, created_at) FROM stdin;
51049089-9aad-460c-81c8-bf890f63a4aa	CARD	Credit / debit card	t	2026-05-02 20:27:07.643283+03
756b7b07-f4db-43dd-a0b7-134929071099	CASH	Cash	t	2026-05-02 20:27:07.643283+03
4605d1a8-ca43-49d6-89dd-5e5768d0db6c	WALLET	Agency wallet	t	2026-05-02 20:27:07.643283+03
226fd081-4a69-454f-8a70-a926994752d1	bank 	salaam bank	t	2026-05-04 05:58:09.585068+03
\.


--
-- Data for Name: md_role_definitions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_role_definitions (id, role_key, display_name, description, updated_at) FROM stdin;
5e0ead17-a6d6-43b4-8c37-83cd809da31f	admin	Administrator	Full system access	2026-05-03 20:45:57.41899+03
79c85e6f-57f0-4b9a-b25a-af500d30e7d0	finance	Finance	Payments and accounting	2026-05-03 20:45:57.41899+03
1047c188-b12a-4d16-b7c3-e4c32740f31c	operations	Operations	Flights and dispatch	2026-05-03 20:45:57.41899+03
65d32771-e960-4a94-8259-2357763add3f	agent	Agent	Bookings and check-in	2026-05-03 20:45:57.41899+03
1ca8576c-f87c-42cd-9abd-80347c1cb338	crew	Crew	Rostered flying duties	2026-05-03 20:45:57.41899+03
28e7740f-f48e-4565-bade-2f0b4ec8c9c1	maintenance	Maintenance	Aircraft defects and release	2026-05-03 20:45:57.41899+03
\.


--
-- Data for Name: md_route_fares; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_route_fares (id, route_id, fare_class_id, amount, currency, is_active, created_at) FROM stdin;
a0747911-87a2-4496-85b1-bf324e967943	87829a9f-9589-4cda-9333-e9a45216069a	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	200.00	USD	t	2026-05-03 14:24:54.000497+03
5a21c664-9358-4e8f-bd12-68852af06d08	10405ec7-1472-46f6-a6e0-0a2ad971e36b	49e4471f-9114-429b-bc06-0a3e57ba9a89	195.00	USD	t	2026-05-03 20:45:57.40998+03
0e0bd174-37c4-4b34-96fe-290dd0498ed7	10405ec7-1472-46f6-a6e0-0a2ad971e36b	67f75463-2c18-49ac-9e78-76f4ebffd783	255.00	USD	t	2026-05-03 20:45:57.40998+03
1fd48704-0770-408c-acaa-d1179a5732fe	10405ec7-1472-46f6-a6e0-0a2ad971e36b	985fb8ba-9706-4a61-9147-900777f90d26	495.00	USD	t	2026-05-03 20:45:57.40998+03
a95534d3-4c81-4f8c-9592-483ff0a48551	0ce8b29a-6c5a-480c-9279-de8b18dc42fa	49e4471f-9114-429b-bc06-0a3e57ba9a89	220.00	USD	t	2026-05-02 20:27:07.639361+03
88d2ea9c-348a-4099-b1ab-916f488bd050	0ce8b29a-6c5a-480c-9279-de8b18dc42fa	67f75463-2c18-49ac-9e78-76f4ebffd783	285.00	USD	t	2026-05-03 20:45:57.40998+03
4a378d05-c6a3-4a74-9fa9-9918fd15f925	0ce8b29a-6c5a-480c-9279-de8b18dc42fa	985fb8ba-9706-4a61-9147-900777f90d26	540.00	USD	t	2026-05-03 20:45:57.40998+03
ff2aefed-b0e4-42c9-a16f-f844e482d2f4	d3a04441-6405-493c-a0f4-aa0af0fd1c73	49e4471f-9114-429b-bc06-0a3e57ba9a89	200.00	USD	t	2026-05-03 20:45:57.535157+03
359e9121-4d77-432c-87a4-2293a7239fd4	d3a04441-6405-493c-a0f4-aa0af0fd1c73	67f75463-2c18-49ac-9e78-76f4ebffd783	260.00	USD	t	2026-05-03 20:45:57.535157+03
4be176c7-41cb-4ba9-bb6e-8be037d86bd1	d3a04441-6405-493c-a0f4-aa0af0fd1c73	985fb8ba-9706-4a61-9147-900777f90d26	480.00	USD	t	2026-05-03 20:45:57.535157+03
7e6222c2-5a76-4ea9-aa51-80d9cb406a4a	55682a87-07f6-4998-a3c6-9a88e17ea0c3	49e4471f-9114-429b-bc06-0a3e57ba9a89	220.00	USD	t	2026-05-02 20:27:07.641706+03
5290c0c4-d390-487a-93b1-087fb8dfbf18	55682a87-07f6-4998-a3c6-9a88e17ea0c3	67f75463-2c18-49ac-9e78-76f4ebffd783	285.00	USD	t	2026-05-03 20:45:57.40998+03
a0a8306e-3298-42cc-b6ae-3a746c6bafab	55682a87-07f6-4998-a3c6-9a88e17ea0c3	985fb8ba-9706-4a61-9147-900777f90d26	540.00	USD	t	2026-05-03 20:45:57.40998+03
1df57ff7-17a8-4a33-a8d8-866816a64fa7	87829a9f-9589-4cda-9333-e9a45216069a	49e4471f-9114-429b-bc06-0a3e57ba9a89	125.00	USD	t	2026-05-03 20:45:57.40998+03
fb0f7fb1-5b78-4785-87c1-cea57b2c224b	87829a9f-9589-4cda-9333-e9a45216069a	67f75463-2c18-49ac-9e78-76f4ebffd783	165.00	USD	t	2026-05-03 20:45:57.40998+03
703391f1-9e68-402d-83f9-d1a04baea165	87829a9f-9589-4cda-9333-e9a45216069a	985fb8ba-9706-4a61-9147-900777f90d26	310.00	USD	t	2026-05-03 20:45:57.40998+03
417fff48-18cf-4eb6-af33-b21d195dd01f	d5ac0881-1bb8-4bcc-a146-0d4e3e141fe9	49e4471f-9114-429b-bc06-0a3e57ba9a89	200.00	USD	t	2026-05-03 20:45:57.535157+03
fd729c17-eac0-479d-a323-0a8e8be39231	d5ac0881-1bb8-4bcc-a146-0d4e3e141fe9	67f75463-2c18-49ac-9e78-76f4ebffd783	260.00	USD	t	2026-05-03 20:45:57.535157+03
29e84e52-8c54-4066-a000-8e5445d6d517	d5ac0881-1bb8-4bcc-a146-0d4e3e141fe9	985fb8ba-9706-4a61-9147-900777f90d26	480.00	USD	t	2026-05-03 20:45:57.535157+03
783e8992-8c0f-4b6f-9eb2-c278915346ad	b82d315b-c578-499a-a93d-c2178a34bef7	49e4471f-9114-429b-bc06-0a3e57ba9a89	200.00	USD	t	2026-05-03 20:45:57.535157+03
a178b3a8-c4db-4131-abfb-e40b62c0b011	b82d315b-c578-499a-a93d-c2178a34bef7	67f75463-2c18-49ac-9e78-76f4ebffd783	260.00	USD	t	2026-05-03 20:45:57.535157+03
de043d85-f3ee-4aea-baf5-3411afee7350	b82d315b-c578-499a-a93d-c2178a34bef7	985fb8ba-9706-4a61-9147-900777f90d26	480.00	USD	t	2026-05-03 20:45:57.535157+03
bd23e8fa-2379-4e9f-be36-d16d9a3628ec	d375a96b-e947-491e-8953-f593418cd996	49e4471f-9114-429b-bc06-0a3e57ba9a89	195.00	USD	t	2026-05-03 20:45:57.40998+03
f37c1b39-4e40-40f6-9fea-a5adb365c139	d375a96b-e947-491e-8953-f593418cd996	67f75463-2c18-49ac-9e78-76f4ebffd783	255.00	USD	t	2026-05-03 20:45:57.40998+03
d93c84fc-dbee-4107-a77f-582eb109e512	d375a96b-e947-491e-8953-f593418cd996	985fb8ba-9706-4a61-9147-900777f90d26	495.00	USD	t	2026-05-03 20:45:57.40998+03
\.


--
-- Data for Name: md_routes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_routes (id, origin_airport_id, dest_airport_id, distance_nm, is_active, created_at) FROM stdin;
10405ec7-1472-46f6-a6e0-0a2ad971e36b	13f052d9-d026-48f5-962f-52b7dbfc972f	45386a7e-08b5-4b58-946f-eaf29921a987	450	t	2026-05-03 20:45:57.409437+03
0ce8b29a-6c5a-480c-9279-de8b18dc42fa	a16dcec2-09dc-4654-be26-8ca22725c8dc	4fd4ccb0-4d9e-42ed-b338-558287076f51	2200	t	2026-05-02 20:27:07.637242+03
d3a04441-6405-493c-a0f4-aa0af0fd1c73	4fd4ccb0-4d9e-42ed-b338-558287076f51	45386a7e-08b5-4b58-946f-eaf29921a987	1200	t	2026-05-03 20:45:57.531516+03
55682a87-07f6-4998-a3c6-9a88e17ea0c3	4fd4ccb0-4d9e-42ed-b338-558287076f51	a16dcec2-09dc-4654-be26-8ca22725c8dc	2200	t	2026-05-02 20:27:07.63859+03
87829a9f-9589-4cda-9333-e9a45216069a	45386a7e-08b5-4b58-946f-eaf29921a987	1c06c87f-6165-4c5f-b387-94164996d65d	\N	t	2026-05-03 14:24:16.601618+03
d5ac0881-1bb8-4bcc-a146-0d4e3e141fe9	45386a7e-08b5-4b58-946f-eaf29921a987	14873603-bd35-460b-80ea-0861aee2455a	1200	t	2026-05-03 20:45:57.531516+03
b82d315b-c578-499a-a93d-c2178a34bef7	45386a7e-08b5-4b58-946f-eaf29921a987	4fd4ccb0-4d9e-42ed-b338-558287076f51	1200	t	2026-05-03 20:45:57.531516+03
d375a96b-e947-491e-8953-f593418cd996	45386a7e-08b5-4b58-946f-eaf29921a987	13f052d9-d026-48f5-962f-52b7dbfc972f	450	t	2026-05-03 20:45:57.408782+03
\.


--
-- Data for Name: md_seat_maps; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_seat_maps (id, name, aircraft_type_id, layout_json, is_active, created_at) FROM stdin;
67b57b62-9ea7-4441-a2ed-b5cdd0877ff1	B738 Default	7f5db2aa-5481-4ffd-a576-1193a8cef33c	{"rows": 28, "economy": "3-3"}	t	2026-05-02 20:27:07.634892+03
\.


--
-- Data for Name: md_system_preferences; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_system_preferences (id, pref_key, pref_value, value_type, updated_at) FROM stdin;
089a4686-462d-487c-b23c-4ca9e913d5d0	default_currency	USD	STRING	2026-05-03 20:45:57.421093+03
d8eb3b32-8edb-48e7-ac60-3ed7848da061	booking_hold_minutes	30	NUMBER	2026-05-03 20:45:57.421093+03
c52d49b4-9f38-4a63-b226-9e7d971558d6	checkin_opens_hours_before	24	NUMBER	2026-05-03 20:45:57.421093+03
\.


--
-- Data for Name: md_tax_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.md_tax_settings (id, code, name, rate_percent, applies_to, sort_order, is_active, created_at) FROM stdin;
314c6ac9-8cac-4506-b576-424123e53ebb	VAT	Value added tax	5.0000	SUBTOTAL	1	t	2026-05-02 20:27:07.642332+03
\.


--
-- Data for Name: ops_routes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ops_routes (id, origin_airport, dest_airport, label, is_active, created_at) FROM stdin;
f65f96d2-2137-43aa-992f-85c70a0a778a	NBO	DXB	Nairobi – Dubai	t	2026-05-02 22:14:11.459435+03
7b3b9f09-1a55-4b30-b645-6981776f9952	MGQ	JIB	Mogadishu – Djibouti	t	2026-05-02 22:14:11.46133+03
49590855-e843-479a-97ae-3dfd142310e8	DXB	NBO	Dubai – Nairobi	t	2026-05-02 22:14:11.461029+03
7880afa4-aeee-4d2b-9eee-ac7a880326ed	MGQ	NBO	\N	t	2026-05-03 10:30:07.40577+03
d9d732c6-8653-48cf-a306-f6e5cabee34b	NBO	MGQ	\N	t	2026-05-03 10:30:25.788884+03
badf9909-fdb4-41ec-8846-f2b24273f9e1	MGQ	HGA	Mogadishu-Hargeisa	t	2026-05-03 10:31:37.059418+03
7b2b7ddd-c788-456c-a7cc-c5842731c020	MGQ	GGR	MOGADISHU-GAROWE	t	2026-05-03 12:55:29.276091+03
\.


--
-- Data for Name: passengers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.passengers (id, first_name, last_name, date_of_birth, nationality, passport_no, phone, email, created_at, gender, passport_expiry, emergency_contact) FROM stdin;
f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	Demo	Passenger	1992-06-15	KE	SEED-BKT-PAX-1	+254700111001	demo.passenger@hams.test	2026-05-02 23:35:56.550352+03	M	2032-01-01	+254700111002
910ede1b-98c2-4e79-b9b2-7186040b58f2	Return	Guest	1988-03-20	KE	SEED-BKT-PAX-2	+254700111003	return.guest@hams.test	2026-05-02 23:35:56.554844+03	F	2031-06-01	+254700111004
074d4b05-6b05-458e-949c-4adea3eb6d14	Finance	Seed Pax	1991-01-01	AE	SEED-FN-PAX-1	+971500000001	fnseed.pax@hams.test	2026-05-02 23:36:37.311208+03	M	2033-01-01	+971500000002
9372495a-a456-4741-a6dd-0bf6ad92bede	ABDIFATAH	ALI	1996-01-10	SOMALI	P1234567	+254700000000	DHUBANE231@GMAIL.COM	2026-05-03 14:26:39.147717+03	MALE	2030-12-31	+254711111111
2cec3acd-e5f2-4cc3-8973-e876ecd5db4e	MADAR	ALI	1996-01-10	Kenyan	P1234567	+254700000000	DHUBANE231@GMAIL.COM	2026-05-03 15:09:07.725417+03	MALE	2030-12-31	+254711111111
6f739dce-a9b6-45e3-8a97-9ebf9ca4a333	abdifatah	ali	1996-01-10	Kenyan	P1234567	+254700000000	dhubane231@gmail.com	2026-05-03 17:26:49.124269+03	MALE	2030-12-31	+254711111111
35c23981-46c2-4d45-9dbf-9417b956140f	mohamed	abdifatah	1996-01-10	Kenyan	P1234567	+254700000000	guest@hawana.aero	2026-05-03 17:48:36.806672+03	MALE	2030-12-31	+254711111111
58246216-90af-44e7-a2b0-d9f79c7669b5	Madar	Mohamud Ali	1996-01-10	Kenyan	P1234567	+254700000000	info@hamitravel.com	2026-05-03 18:06:37.675944+03	MALE	2030-12-31	+254711111111
33be4b60-c6ea-4d1e-b159-e0e810b560e2	Mohamed	Abdifatah Mohamud	1996-01-10	somali	P1234567	+254700000000	guest@hawana.aero	2026-05-05 02:49:37.818837+03	MALE	2030-12-31	+254711111111
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payments (id, booking_id, payment_type, amount, currency, payment_status, transaction_ref, processed_by, processed_at) FROM stdin;
047766b5-2220-4fb0-a7e7-eb2b97545949	03ec9c3a-4250-4793-a02d-02c179ebca5d	CARD	1200.00	USD	PAID	SEED-PAY-1	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 21:20:08.777509+03
09f3aadc-1bd3-44ec-86b4-6676216fc804	8ede22b5-6fea-4fb2-a059-03654a390c73	CARD	520.00	USD	PAID	SEED-BKTOW1-PAY	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 23:36:37.306307+03
f499d9fa-06a9-41e8-a7d5-46a900e88cdc	f2a6ce03-3ae5-4f1b-ae0e-ea76b13b0bb2	CARD	980.00	USD	PENDING	SEED-BKTRTN1-PEND	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 23:36:37.310628+03
46803e40-2c6f-4fe6-bf6f-63f4d0d60290	bb567afa-57c6-458c-8bec-3297eab03bd3	CARD	225.00	USD	PAID	TXN-1777807599167	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 14:26:39.147717+03
dd7e6feb-7c98-467d-b24a-07d99d31b01b	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	CARD	225.00	USD	PAID	TXN-1777810147737	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 15:09:07.725417+03
ae907fe5-36ad-4dbd-b455-befb8028b478	50bd8196-d0a3-455c-a198-674b99b8af44	CARD	225.00	USD	PAID	TXN-1777818409140	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:26:49.124269+03
b841a23e-05d0-4175-95f1-c2449260ca0b	1e95b8ca-6511-4860-b75e-3b8bacb38de1	CARD	225.00	USD	PAID	TXN-1777819716825	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 17:48:36.806672+03
aa24a0ca-e5b0-4c17-aec2-d609846e0d16	6167e339-c2b1-4307-8d3c-1d3c09d802a0	CARD	225.00	USD	PAID	TXN-1777820862033	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-03 18:07:42.030916+03
b93687c3-6b82-424e-93fe-9710510e7e83	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	CARD	233.00	USD	PAID	TXN-1777938597639	1ce56b41-35df-4bb6-bd91-128b158302b1	2026-05-05 02:49:57.638158+03
\.


--
-- Data for Name: refund_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.refund_requests (id, payment_id, amount, currency, reason, status, requested_by, reviewed_by, reviewed_at, rejection_reason, created_at) FROM stdin;
\.


--
-- Data for Name: refunds; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.refunds (id, payment_id, refund_amount, reason, approved_by, refunded_at, refund_request_id) FROM stdin;
\.


--
-- Data for Name: sales_campaigns; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_campaigns (id, name, channel, start_date, end_date, budget_amount, currency, utm_source, utm_medium, utm_campaign, notes, created_by, created_at) FROM stdin;
cd644e30-6021-4ab4-aa56-318470732a6e	Q2 East Africa digital	EMAIL	2026-04-02	2026-07-01	50000.00	USD	\N	\N	q2_ea_digital	\N	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 22:14:44.655156+03
1942a5d4-3298-4f07-9c82-a0deff5287d8	Nairobi airport OOH	OOH	2026-04-18	2026-08-30	12000.00	USD	\N	\N	\N	\N	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	2026-05-02 22:14:44.663047+03
\.


--
-- Data for Name: sales_corporate_customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_corporate_customers (id, legal_name, tax_id, billing_email, phone, default_discount_percent, notes, created_at, status, credit_limit, credit_balance, payment_terms, billing_cycle_days, travel_policy_json, fare_agreement_json) FROM stdin;
\.


--
-- Data for Name: sales_customer_segments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_customer_segments (id, name, description, rules_json, created_at) FROM stdin;
\.


--
-- Data for Name: sales_leads; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_leads (id, company_name, contact_name, email, phone, source, status, expected_value, currency, assigned_to, campaign_id, notes, created_at, updated_at) FROM stdin;
2efb6ecd-8a6f-423d-98ec-2c01524e195f	Acme Tours Ltd	Jane Buyer	jane@acme-seed.test	+254700000001	WEB	QUALIFIED	45000.00	USD	\N	cd644e30-6021-4ab4-aa56-318470732a6e	Seed lead — qualified opportunity.	2026-05-02 22:14:44.666281+03	2026-05-02 22:14:44.666281+03
0a60b70b-fc97-43e8-b6e9-4aa223c4f924	\N	Sam Prospect	sam@prospect-seed.test	\N	REFERRAL	NEW	12000.00	USD	\N	cd644e30-6021-4ab4-aa56-318470732a6e	\N	2026-05-02 22:14:44.667296+03	2026-05-02 22:14:44.667296+03
cd95e8b3-02e5-4ee3-8f90-a1f81c247ef8	Coastal Holidays	Maria Lead	maria@coastal-seed.test	\N	EVENT	PROPOSAL	28000.00	USD	\N	1942a5d4-3298-4f07-9c82-a0deff5287d8	\N	2026-05-02 22:14:44.667664+03	2026-05-02 22:14:44.667664+03
\.


--
-- Data for Name: sales_promo_codes; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_promo_codes (id, code, description, discount_type, discount_value, currency, valid_from, valid_until, usage_limit, used_count, active, created_at) FROM stdin;
603372e2-c579-4d60-9dec-d3850618e073	SUMMER10	Seed: 10% off published fares	PERCENT	10.00	USD	2026-04-25	2027-05-02	500	3	t	2026-05-02 22:14:44.664153+03
1ddc5b1d-3265-482a-8c27-36de9b40ab24	FARE50	Seed: USD 50 off	FIXED_AMOUNT	50.00	USD	2026-05-01	2026-10-29	200	1	t	2026-05-02 22:14:44.665798+03
\.


--
-- Data for Name: sales_route_promotions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_route_promotions (id, promo_code_id, origin_airport, dest_airport, created_at) FROM stdin;
\.


--
-- Data for Name: sales_segment_members; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_segment_members (segment_id, passenger_id, added_at) FROM stdin;
\.


--
-- Data for Name: sales_travel_agents; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sales_travel_agents (id, company_name, contact_name, email, phone, iata_code, user_id, commission_percent, notes, created_at, approval_status, credit_limit, credit_balance, debt_balance) FROM stdin;
f4397cf7-fc0b-4370-ac15-26d7e1b4f703	Skylink Travel	Agent Desk	desk@skylink-seed.test	+971500000000	SKY999	1d2241c6-92f4-4e6b-889a-55504ad448a0	7.50	Seed — linked to booking agent user when present.	2026-05-02 22:14:44.66804+03	APPROVED	\N	\N	0.00
7bcb3620-b66a-4b28-8e2b-8320d18b3def	Global Fares Desk	B2B Sales	b2b@globalfares-seed.test	\N	GF-IA	\N	5.00	Seed travel agent (no linked user).	2026-05-02 22:14:44.672001+03	APPROVED	\N	\N	0.00
\.


--
-- Data for Name: sm_agent_commissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_agent_commissions (id, booking_id, ticket_id, travel_agent_id, channel_code, base_amount, commission_rate, commission_amount, currency, status, rule_snapshot, created_at) FROM stdin;
\.


--
-- Data for Name: sm_ancillary_products; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_ancillary_products (code, label, category, default_price, currency, active) FROM stdin;
XBAG	Extra baggage	BAGGAGE	35.00	USD	t
SEAT	Seat selection	SEAT	15.00	USD	t
PRIO	Priority boarding	SERVICE	25.00	USD	t
MEAL	Meal	CATERING	12.00	USD	t
CHGFEE	Change fee	FEE	75.00	USD	t
UPGFEE	Upgrade fee	UPGRADE	120.00	USD	t
\.


--
-- Data for Name: sm_ancillary_sales; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_ancillary_sales (id, booking_id, product_code, quantity, unit_price, currency, status, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: sm_automation_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_automation_rules (id, trigger_code, channel, campaign_id, template_key, schedule_cron, active, metadata_json, created_at) FROM stdin;
\.


--
-- Data for Name: sm_commission_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_commission_rules (id, rule_type, channel_code, origin_airport, dest_airport, promo_code_id, commission_percent, priority, active, created_at) FROM stdin;
\.


--
-- Data for Name: sm_corporate_contracts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_corporate_contracts (id, corporate_id, title, discount_percent, valid_from, valid_until, contract_json, created_at) FROM stdin;
\.


--
-- Data for Name: sm_corporate_travelers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_corporate_travelers (id, corporate_id, passenger_id, employee_ref, created_at) FROM stdin;
\.


--
-- Data for Name: sm_crm_customers; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_crm_customers (passenger_id, status, segment_tag, total_spend, booking_count, preferred_routes_json, complaint_count, last_booking_at, updated_at) FROM stdin;
33be4b60-c6ea-4d1e-b159-e0e810b560e2	ACTIVE	\N	233.00	1	["MGQ→GGR"]	0	2026-05-05 02:49:37.818+03	2026-05-05 02:49:37.818837+03
\.


--
-- Data for Name: sm_dynamic_pricing_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_dynamic_pricing_rules (id, name, priority, conditions_json, adjustment_type, adjustment_value, active, created_at) FROM stdin;
\.


--
-- Data for Name: sm_fare_class_family_map; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_fare_class_family_map (fare_class_id, family_id) FROM stdin;
\.


--
-- Data for Name: sm_fare_families; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_fare_families (id, code, name, cabin, sort_order) FROM stdin;
95259102-fd60-48b2-aafe-c14ab3fa314d	ECON_SAVER	Economy Saver	ECONOMY	10
0b2f5f69-4db2-40ca-968a-2b803fcd9c98	ECON_FLEX	Economy Flex	ECONOMY	20
5cce9383-545c-4274-aa5d-b32cc307a22f	BUSINESS	Business	BUSINESS	30
\.


--
-- Data for Name: sm_fare_rules; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_fare_rules (id, fare_class_id, rule_key, rule_value_json, effective_from, effective_to, updated_by, updated_at) FROM stdin;
\.


--
-- Data for Name: sm_lead_followups; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_lead_followups (id, lead_id, remind_at, note, completed, created_at) FROM stdin;
\.


--
-- Data for Name: sm_loyalty_accounts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_loyalty_accounts (id, passenger_id, miles_balance, tier, created_at, updated_at) FROM stdin;
49a2b2aa-a53c-42d6-b573-dae25dda31a7	33be4b60-c6ea-4d1e-b159-e0e810b560e2	4	SILVER	2026-05-05 02:49:57.638158+03	2026-05-05 02:49:57.638158+03
\.


--
-- Data for Name: sm_loyalty_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_loyalty_transactions (id, loyalty_account_id, txn_type, miles, booking_id, description, metadata, created_at) FROM stdin;
4cb75ff3-c30d-4e84-8f1a-f9ac43ab2f1d	49a2b2aa-a53c-42d6-b573-dae25dda31a7	EARN	4	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	Miles for ticket revenue on NKNP9W	{}	2026-05-05 02:49:57.638158+03
\.


--
-- Data for Name: sm_promo_usage; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_promo_usage (id, promo_code_id, booking_id, discount_amount, used_at) FROM stdin;
\.


--
-- Data for Name: sm_rm_flight_bucket; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_rm_flight_bucket (id, flight_id, fare_class_id, seats_allocated, seats_sold, bucket_open, updated_at) FROM stdin;
\.


--
-- Data for Name: sm_rm_policy; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_rm_policy (id, load_factor_close_bucket, load_factor_open_upper, updated_at) FROM stdin;
1	0.78	0.55	2026-05-03 20:45:57.968437+03
\.


--
-- Data for Name: sm_route_profitability; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_route_profitability (id, period_start, period_end, origin_airport, dest_airport, revenue, cost_estimate, bookings, passengers, load_factor, yield_per_pax, computed_at) FROM stdin;
\.


--
-- Data for Name: sm_sales_channels; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_sales_channels (id, code, name, default_commission_pct, active, created_at) FROM stdin;
4f39d8ac-65b4-4360-a2aa-2158e9770aaf	DIRECT_WEB	Website direct	0.000	t	2026-05-03 20:45:57.910655+03
9aa7f23a-1366-4257-9503-f5f18e44a9ac	MOBILE_APP	Mobile app	0.000	t	2026-05-03 20:45:57.910655+03
7aca2940-e2f4-4f26-86f6-676e14068a72	AGENT_PORTAL	Travel agent portal	7.000	t	2026-05-03 20:45:57.910655+03
2d5bd322-51ee-4a2a-abca-426011c4a9c4	CORPORATE_PORTAL	Corporate portal	3.000	t	2026-05-03 20:45:57.910655+03
8eb2a58c-7f10-4e6a-88a3-b622f7e40e95	API	API partner	5.000	t	2026-05-03 20:45:57.910655+03
dbd323ea-507d-4045-ac0b-12e0b8c4e4ad	OTA	Online travel agency	12.000	t	2026-05-03 20:45:57.910655+03
50eaa018-d7fe-426f-816e-7d9a0b8714e7	GDS_PREP	GDS (preparation)	10.000	t	2026-05-03 20:45:57.910655+03
f53366e0-1c78-4ff2-9899-3e7b06df909e	CALL_CENTER	Call center	0.000	t	2026-05-03 20:45:57.910655+03
\.


--
-- Data for Name: sm_seasonal_route_fare; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_seasonal_route_fare (id, origin_airport, dest_airport, fare_class_id, season_start, season_end, fare_multiplier, notes, active, created_at) FROM stdin;
\.


--
-- Data for Name: sm_seat_leg_allocation; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.sm_seat_leg_allocation (id, booking_id, flight_id, passenger_id, ticket_id, fare_class_id, cabin_class, created_at, seat_number, seat_status, updated_at) FROM stdin;
aa9b1aa7-cd55-4f7f-98c2-934b5af15c8e	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	71b836ba-8c5b-464d-8d76-34631fe4a2f8	2cec3acd-e5f2-4cc3-8973-e876ecd5db4e	20434a43-b491-4230-b04e-23b1758b01f6	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	ECONOMY	2026-05-05 02:39:55.398453+03	\N	ALLOCATED	2026-05-05 02:39:55.398453+03
08ccc773-6364-48e7-8dcb-df2c20d09180	1e95b8ca-6511-4860-b75e-3b8bacb38de1	71b836ba-8c5b-464d-8d76-34631fe4a2f8	35c23981-46c2-4d45-9dbf-9417b956140f	40ab901a-abcf-485f-8731-4c4b45b7b290	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	ECONOMY	2026-05-05 02:39:55.398453+03	\N	ALLOCATED	2026-05-05 02:39:55.398453+03
1b058bd2-edfd-459a-b49c-191b8ed99bdb	bb567afa-57c6-458c-8bec-3297eab03bd3	71b836ba-8c5b-464d-8d76-34631fe4a2f8	9372495a-a456-4741-a6dd-0bf6ad92bede	4d82a92a-72aa-440e-b82c-b1fab497dfda	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	ECONOMY	2026-05-05 02:39:55.398453+03	\N	ALLOCATED	2026-05-05 02:39:55.398453+03
b98d61f6-aa4d-4fd6-8fde-099c102c8caa	50bd8196-d0a3-455c-a198-674b99b8af44	71b836ba-8c5b-464d-8d76-34631fe4a2f8	6f739dce-a9b6-45e3-8a97-9ebf9ca4a333	8a52890e-3fff-4095-9965-159301fe731d	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	ECONOMY	2026-05-05 02:39:55.398453+03	\N	ALLOCATED	2026-05-05 02:39:55.398453+03
3819a29d-7055-4b8b-9f2f-791122503535	6167e339-c2b1-4307-8d3c-1d3c09d802a0	71b836ba-8c5b-464d-8d76-34631fe4a2f8	58246216-90af-44e7-a2b0-d9f79c7669b5	3483b557-c267-461e-a31d-6f49a0f1e51e	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	ECONOMY	2026-05-05 02:39:55.398453+03	\N	ALLOCATED	2026-05-05 02:39:55.398453+03
635c1851-9988-4ef9-bd4e-87d349013cd8	8ede22b5-6fea-4fb2-a059-03654a390c73	21f029b0-37c7-471e-9742-160de9ab72a1	f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	d76dc010-efef-494f-9de1-556a2993f857	\N	ECONOMY	2026-05-05 02:39:55.398453+03	\N	ALLOCATED	2026-05-05 02:39:55.398453+03
3dfbc98a-3de5-4148-9b98-2a8e1df528fa	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	71b836ba-8c5b-464d-8d76-34631fe4a2f8	33be4b60-c6ea-4d1e-b159-e0e810b560e2	c9684386-3348-4072-9071-9eda1d39238f	3011d353-79c9-4a37-b363-0e3bf4c4dcc1	ECONOMY	2026-05-05 02:49:57.638158+03	\N	ALLOCATED	2026-05-05 02:49:57.638158+03
\.


--
-- Data for Name: tickets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tickets (id, ticket_number, booking_id, passenger_id, issued_at, issued_by, ticket_status) FROM stdin;
d76dc010-efef-494f-9de1-556a2993f857	555SEEDBKTOW01	8ede22b5-6fea-4fb2-a059-03654a390c73	f3f45f3e-1b9b-43b7-82a0-684b049f6a0e	2026-05-02 23:36:37.307346+03	ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	ISSUED
4d82a92a-72aa-440e-b82c-b1fab497dfda	5558204942623	bb567afa-57c6-458c-8bec-3297eab03bd3	9372495a-a456-4741-a6dd-0bf6ad92bede	2026-05-03 14:26:39.147717+03	1ce56b41-35df-4bb6-bd91-128b158302b1	ISSUED
20434a43-b491-4230-b04e-23b1758b01f6	5551888890943	d19d5a1a-5550-4d3b-8a5b-89de2869dd7c	2cec3acd-e5f2-4cc3-8973-e876ecd5db4e	2026-05-03 15:09:07.725417+03	1ce56b41-35df-4bb6-bd91-128b158302b1	ISSUED
8a52890e-3fff-4095-9965-159301fe731d	5557825577883	50bd8196-d0a3-455c-a198-674b99b8af44	6f739dce-a9b6-45e3-8a97-9ebf9ca4a333	2026-05-03 17:26:49.124269+03	1ce56b41-35df-4bb6-bd91-128b158302b1	ISSUED
40ab901a-abcf-485f-8731-4c4b45b7b290	5550724718681	1e95b8ca-6511-4860-b75e-3b8bacb38de1	35c23981-46c2-4d45-9dbf-9417b956140f	2026-05-03 17:48:36.806672+03	1ce56b41-35df-4bb6-bd91-128b158302b1	ISSUED
3483b557-c267-461e-a31d-6f49a0f1e51e	5558997648191	6167e339-c2b1-4307-8d3c-1d3c09d802a0	58246216-90af-44e7-a2b0-d9f79c7669b5	2026-05-03 18:07:42.030916+03	1ce56b41-35df-4bb6-bd91-128b158302b1	ISSUED
c9684386-3348-4072-9071-9eda1d39238f	5559990393297	c2d02bac-8a2c-44e8-a9a8-426a90d26cca	33be4b60-c6ea-4d1e-b159-e0e810b560e2	2026-05-05 02:49:57.638158+03	1ce56b41-35df-4bb6-bd91-128b158302b1	ISSUED
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, full_name, email, password_hash, role, is_active, created_at, updated_at, password_reset_token, password_reset_expires_at, failed_login_count, locked_until, totp_secret_enc, totp_pending_secret_enc, totp_enabled, password_changed_at, last_activity_at) FROM stdin;
1ce56b41-35df-4bb6-bd91-128b158302b1	Hawana Airways Admin	admin@hawanaairways.com	$2b$10$xavnCa/8O0uMAf/BLVNCp.EQOVejcBPWD31LoFSyqEikMF.Vk.exy	super_admin	t	2026-05-03 06:45:45.52627+03	2026-05-05 10:30:03.46307+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	2026-05-05 10:30:03.480233+03
ca7e89fb-6c71-4c61-9bfd-8ab3b78a4128	HAMS Super Admin	admin@hams.aero	$2b$10$f5fGrQyMMbIkFirzefVyeOXA1fS4hMbjUV7V/mKGGAHx4nJzszex6	admin	t	2026-05-01 13:38:26.388813+03	2026-05-05 16:57:37.081109+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	2026-05-05 16:57:29.51029+03
49cfb4c6-7b52-484b-b7b2-54c5072230d2	Finance User	finance@hams.aero	$2b$10$f5fGrQyMMbIkFirzefVyeOXA1fS4hMbjUV7V/mKGGAHx4nJzszex6	finance	t	2026-05-01 13:38:26.388813+03	2026-05-01 13:38:26.388813+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	\N
a12830a8-4d51-4ecf-bfc4-a170aa3f9b99	Operations User	ops@hams.aero	$2b$10$f5fGrQyMMbIkFirzefVyeOXA1fS4hMbjUV7V/mKGGAHx4nJzszex6	operations	t	2026-05-01 13:38:26.388813+03	2026-05-01 13:38:26.388813+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	\N
1d2241c6-92f4-4e6b-889a-55504ad448a0	Booking Agent	agent@hams.aero	$2b$10$f5fGrQyMMbIkFirzefVyeOXA1fS4hMbjUV7V/mKGGAHx4nJzszex6	agent	t	2026-05-01 13:38:26.388813+03	2026-05-01 13:38:26.388813+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	\N
26236592-4ef9-45a7-9000-60df1cd8c89e	Crew Member	crew@hams.aero	$2b$10$f5fGrQyMMbIkFirzefVyeOXA1fS4hMbjUV7V/mKGGAHx4nJzszex6	crew	t	2026-05-01 13:38:26.388813+03	2026-05-01 13:38:26.388813+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	\N
69a35569-645f-4139-944e-c21644a1685c	Maintenance Engineer	mx@hams.aero	$2b$10$f5fGrQyMMbIkFirzefVyeOXA1fS4hMbjUV7V/mKGGAHx4nJzszex6	maintenance	t	2026-05-01 13:38:26.388813+03	2026-05-01 13:38:26.388813+03	\N	\N	0	\N	\N	\N	f	2026-05-05 02:25:20.909371+03	\N
\.


--
-- Name: aircraft aircraft_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aircraft
    ADD CONSTRAINT aircraft_pkey PRIMARY KEY (id);


--
-- Name: aircraft aircraft_tail_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aircraft
    ADD CONSTRAINT aircraft_tail_number_key UNIQUE (tail_number);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: baggage baggage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baggage
    ADD CONSTRAINT baggage_pkey PRIMARY KEY (id);


--
-- Name: baggage baggage_tag_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baggage
    ADD CONSTRAINT baggage_tag_number_key UNIQUE (tag_number);


--
-- Name: booking_flights booking_flights_booking_id_flight_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_flights
    ADD CONSTRAINT booking_flights_booking_id_flight_id_key UNIQUE (booking_id, flight_id);


--
-- Name: booking_flights booking_flights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_flights
    ADD CONSTRAINT booking_flights_pkey PRIMARY KEY (id);


--
-- Name: booking_passengers booking_passengers_booking_id_passenger_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_passengers
    ADD CONSTRAINT booking_passengers_booking_id_passenger_id_key UNIQUE (booking_id, passenger_id);


--
-- Name: booking_passengers booking_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_passengers
    ADD CONSTRAINT booking_passengers_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);


--
-- Name: bookings bookings_pnr_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_pnr_key UNIQUE (pnr);


--
-- Name: checkins checkins_boarding_pass_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_boarding_pass_no_key UNIQUE (boarding_pass_no);


--
-- Name: checkins checkins_passenger_id_flight_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_passenger_id_flight_id_key UNIQUE (passenger_id, flight_id);


--
-- Name: checkins checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_pkey PRIMARY KEY (id);


--
-- Name: crew_assignments crew_assignments_flight_id_crew_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_assignments
    ADD CONSTRAINT crew_assignments_flight_id_crew_user_id_key UNIQUE (flight_id, crew_user_id);


--
-- Name: crew_assignments crew_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_assignments
    ADD CONSTRAINT crew_assignments_pkey PRIMARY KEY (id);


--
-- Name: crew_availability crew_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_availability
    ADD CONSTRAINT crew_availability_pkey PRIMARY KEY (id);


--
-- Name: crew_documents crew_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_documents
    ADD CONSTRAINT crew_documents_pkey PRIMARY KEY (id);


--
-- Name: crew_duty_logs crew_duty_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_duty_logs
    ADD CONSTRAINT crew_duty_logs_pkey PRIMARY KEY (id);


--
-- Name: crew_duty_logs crew_duty_logs_user_id_flight_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_duty_logs
    ADD CONSTRAINT crew_duty_logs_user_id_flight_id_key UNIQUE (user_id, flight_id);


--
-- Name: crew_licenses crew_licenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_licenses
    ADD CONSTRAINT crew_licenses_pkey PRIMARY KEY (id);


--
-- Name: crew_medicals crew_medicals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_medicals
    ADD CONSTRAINT crew_medicals_pkey PRIMARY KEY (id);


--
-- Name: crew_profiles crew_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_profiles
    ADD CONSTRAINT crew_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: crew_training crew_training_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_training
    ADD CONSTRAINT crew_training_pkey PRIMARY KEY (id);


--
-- Name: cs_case_notes cs_case_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_case_notes
    ADD CONSTRAINT cs_case_notes_pkey PRIMARY KEY (id);


--
-- Name: cs_customer_profiles cs_customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_customer_profiles
    ADD CONSTRAINT cs_customer_profiles_pkey PRIMARY KEY (passenger_id);


--
-- Name: cs_service_cases cs_service_cases_case_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_case_ref_key UNIQUE (case_ref);


--
-- Name: cs_service_cases cs_service_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_pkey PRIMARY KEY (id);


--
-- Name: dispatch_logs dispatch_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_logs
    ADD CONSTRAINT dispatch_logs_pkey PRIMARY KEY (id);


--
-- Name: finance_expenses finance_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_pkey PRIMARY KEY (id);


--
-- Name: finance_transactions finance_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_pkey PRIMARY KEY (id);


--
-- Name: flight_delays flight_delays_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_delays
    ADD CONSTRAINT flight_delays_pkey PRIMARY KEY (id);


--
-- Name: flights flights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flights
    ADD CONSTRAINT flights_pkey PRIMARY KEY (id);


--
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- Name: maintenance_inspections maintenance_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_inspections
    ADD CONSTRAINT maintenance_inspections_pkey PRIMARY KEY (id);


--
-- Name: maintenance_logs maintenance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_pkey PRIMARY KEY (id);


--
-- Name: md_aircraft_types md_aircraft_types_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_aircraft_types
    ADD CONSTRAINT md_aircraft_types_code_key UNIQUE (code);


--
-- Name: md_aircraft_types md_aircraft_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_aircraft_types
    ADD CONSTRAINT md_aircraft_types_pkey PRIMARY KEY (id);


--
-- Name: md_airports md_airports_iata_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_airports
    ADD CONSTRAINT md_airports_iata_code_key UNIQUE (iata_code);


--
-- Name: md_airports md_airports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_airports
    ADD CONSTRAINT md_airports_pkey PRIMARY KEY (id);


--
-- Name: md_baggage_rules md_baggage_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_baggage_rules
    ADD CONSTRAINT md_baggage_rules_pkey PRIMARY KEY (id);


--
-- Name: md_cities md_cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_cities
    ADD CONSTRAINT md_cities_pkey PRIMARY KEY (id);


--
-- Name: md_countries md_countries_iso2_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_countries
    ADD CONSTRAINT md_countries_iso2_key UNIQUE (iso2);


--
-- Name: md_countries md_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_countries
    ADD CONSTRAINT md_countries_pkey PRIMARY KEY (id);


--
-- Name: md_currencies md_currencies_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_currencies
    ADD CONSTRAINT md_currencies_code_key UNIQUE (code);


--
-- Name: md_currencies md_currencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_currencies
    ADD CONSTRAINT md_currencies_pkey PRIMARY KEY (id);


--
-- Name: md_departments md_departments_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_departments
    ADD CONSTRAINT md_departments_code_key UNIQUE (code);


--
-- Name: md_departments md_departments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_departments
    ADD CONSTRAINT md_departments_pkey PRIMARY KEY (id);


--
-- Name: md_fare_classes md_fare_classes_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_fare_classes
    ADD CONSTRAINT md_fare_classes_code_key UNIQUE (code);


--
-- Name: md_fare_classes md_fare_classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_fare_classes
    ADD CONSTRAINT md_fare_classes_pkey PRIMARY KEY (id);


--
-- Name: md_fee_settings md_fee_settings_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_fee_settings
    ADD CONSTRAINT md_fee_settings_code_key UNIQUE (code);


--
-- Name: md_fee_settings md_fee_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_fee_settings
    ADD CONSTRAINT md_fee_settings_pkey PRIMARY KEY (id);


--
-- Name: md_payment_methods md_payment_methods_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_payment_methods
    ADD CONSTRAINT md_payment_methods_code_key UNIQUE (code);


--
-- Name: md_payment_methods md_payment_methods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_payment_methods
    ADD CONSTRAINT md_payment_methods_pkey PRIMARY KEY (id);


--
-- Name: md_role_definitions md_role_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_role_definitions
    ADD CONSTRAINT md_role_definitions_pkey PRIMARY KEY (id);


--
-- Name: md_role_definitions md_role_definitions_role_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_role_definitions
    ADD CONSTRAINT md_role_definitions_role_key_key UNIQUE (role_key);


--
-- Name: md_route_fares md_route_fares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_route_fares
    ADD CONSTRAINT md_route_fares_pkey PRIMARY KEY (id);


--
-- Name: md_route_fares md_route_fares_route_id_fare_class_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_route_fares
    ADD CONSTRAINT md_route_fares_route_id_fare_class_id_key UNIQUE (route_id, fare_class_id);


--
-- Name: md_routes md_routes_origin_airport_id_dest_airport_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_routes
    ADD CONSTRAINT md_routes_origin_airport_id_dest_airport_id_key UNIQUE (origin_airport_id, dest_airport_id);


--
-- Name: md_routes md_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_routes
    ADD CONSTRAINT md_routes_pkey PRIMARY KEY (id);


--
-- Name: md_seat_maps md_seat_maps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_seat_maps
    ADD CONSTRAINT md_seat_maps_pkey PRIMARY KEY (id);


--
-- Name: md_system_preferences md_system_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_system_preferences
    ADD CONSTRAINT md_system_preferences_pkey PRIMARY KEY (id);


--
-- Name: md_system_preferences md_system_preferences_pref_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_system_preferences
    ADD CONSTRAINT md_system_preferences_pref_key_key UNIQUE (pref_key);


--
-- Name: md_tax_settings md_tax_settings_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_tax_settings
    ADD CONSTRAINT md_tax_settings_code_key UNIQUE (code);


--
-- Name: md_tax_settings md_tax_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_tax_settings
    ADD CONSTRAINT md_tax_settings_pkey PRIMARY KEY (id);


--
-- Name: ops_routes ops_routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_routes
    ADD CONSTRAINT ops_routes_pkey PRIMARY KEY (id);


--
-- Name: passengers passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passengers
    ADD CONSTRAINT passengers_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: refund_requests refund_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: sales_campaigns sales_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_campaigns
    ADD CONSTRAINT sales_campaigns_pkey PRIMARY KEY (id);


--
-- Name: sales_corporate_customers sales_corporate_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_corporate_customers
    ADD CONSTRAINT sales_corporate_customers_pkey PRIMARY KEY (id);


--
-- Name: sales_customer_segments sales_customer_segments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_customer_segments
    ADD CONSTRAINT sales_customer_segments_pkey PRIMARY KEY (id);


--
-- Name: sales_leads sales_leads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_leads
    ADD CONSTRAINT sales_leads_pkey PRIMARY KEY (id);


--
-- Name: sales_promo_codes sales_promo_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_promo_codes
    ADD CONSTRAINT sales_promo_codes_pkey PRIMARY KEY (id);


--
-- Name: sales_route_promotions sales_route_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_route_promotions
    ADD CONSTRAINT sales_route_promotions_pkey PRIMARY KEY (id);


--
-- Name: sales_route_promotions sales_route_promotions_promo_code_id_origin_airport_dest_ai_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_route_promotions
    ADD CONSTRAINT sales_route_promotions_promo_code_id_origin_airport_dest_ai_key UNIQUE (promo_code_id, origin_airport, dest_airport);


--
-- Name: sales_segment_members sales_segment_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_segment_members
    ADD CONSTRAINT sales_segment_members_pkey PRIMARY KEY (segment_id, passenger_id);


--
-- Name: sales_travel_agents sales_travel_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_travel_agents
    ADD CONSTRAINT sales_travel_agents_pkey PRIMARY KEY (id);


--
-- Name: sm_agent_commissions sm_agent_commissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_agent_commissions
    ADD CONSTRAINT sm_agent_commissions_pkey PRIMARY KEY (id);


--
-- Name: sm_ancillary_products sm_ancillary_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_ancillary_products
    ADD CONSTRAINT sm_ancillary_products_pkey PRIMARY KEY (code);


--
-- Name: sm_ancillary_sales sm_ancillary_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_ancillary_sales
    ADD CONSTRAINT sm_ancillary_sales_pkey PRIMARY KEY (id);


--
-- Name: sm_automation_rules sm_automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_automation_rules
    ADD CONSTRAINT sm_automation_rules_pkey PRIMARY KEY (id);


--
-- Name: sm_commission_rules sm_commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_commission_rules
    ADD CONSTRAINT sm_commission_rules_pkey PRIMARY KEY (id);


--
-- Name: sm_corporate_contracts sm_corporate_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_corporate_contracts
    ADD CONSTRAINT sm_corporate_contracts_pkey PRIMARY KEY (id);


--
-- Name: sm_corporate_travelers sm_corporate_travelers_corporate_id_passenger_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_corporate_travelers
    ADD CONSTRAINT sm_corporate_travelers_corporate_id_passenger_id_key UNIQUE (corporate_id, passenger_id);


--
-- Name: sm_corporate_travelers sm_corporate_travelers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_corporate_travelers
    ADD CONSTRAINT sm_corporate_travelers_pkey PRIMARY KEY (id);


--
-- Name: sm_crm_customers sm_crm_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_crm_customers
    ADD CONSTRAINT sm_crm_customers_pkey PRIMARY KEY (passenger_id);


--
-- Name: sm_dynamic_pricing_rules sm_dynamic_pricing_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_dynamic_pricing_rules
    ADD CONSTRAINT sm_dynamic_pricing_rules_pkey PRIMARY KEY (id);


--
-- Name: sm_fare_class_family_map sm_fare_class_family_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_class_family_map
    ADD CONSTRAINT sm_fare_class_family_map_pkey PRIMARY KEY (fare_class_id);


--
-- Name: sm_fare_families sm_fare_families_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_families
    ADD CONSTRAINT sm_fare_families_code_key UNIQUE (code);


--
-- Name: sm_fare_families sm_fare_families_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_families
    ADD CONSTRAINT sm_fare_families_pkey PRIMARY KEY (id);


--
-- Name: sm_fare_rules sm_fare_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_rules
    ADD CONSTRAINT sm_fare_rules_pkey PRIMARY KEY (id);


--
-- Name: sm_lead_followups sm_lead_followups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_lead_followups
    ADD CONSTRAINT sm_lead_followups_pkey PRIMARY KEY (id);


--
-- Name: sm_loyalty_accounts sm_loyalty_accounts_passenger_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_loyalty_accounts
    ADD CONSTRAINT sm_loyalty_accounts_passenger_id_key UNIQUE (passenger_id);


--
-- Name: sm_loyalty_accounts sm_loyalty_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_loyalty_accounts
    ADD CONSTRAINT sm_loyalty_accounts_pkey PRIMARY KEY (id);


--
-- Name: sm_loyalty_transactions sm_loyalty_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_loyalty_transactions
    ADD CONSTRAINT sm_loyalty_transactions_pkey PRIMARY KEY (id);


--
-- Name: sm_promo_usage sm_promo_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_promo_usage
    ADD CONSTRAINT sm_promo_usage_pkey PRIMARY KEY (id);


--
-- Name: sm_promo_usage sm_promo_usage_promo_code_id_booking_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_promo_usage
    ADD CONSTRAINT sm_promo_usage_promo_code_id_booking_id_key UNIQUE (promo_code_id, booking_id);


--
-- Name: sm_rm_flight_bucket sm_rm_flight_bucket_flight_id_fare_class_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_rm_flight_bucket
    ADD CONSTRAINT sm_rm_flight_bucket_flight_id_fare_class_id_key UNIQUE (flight_id, fare_class_id);


--
-- Name: sm_rm_flight_bucket sm_rm_flight_bucket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_rm_flight_bucket
    ADD CONSTRAINT sm_rm_flight_bucket_pkey PRIMARY KEY (id);


--
-- Name: sm_rm_policy sm_rm_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_rm_policy
    ADD CONSTRAINT sm_rm_policy_pkey PRIMARY KEY (id);


--
-- Name: sm_route_profitability sm_route_profitability_period_start_period_end_origin_airpo_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_route_profitability
    ADD CONSTRAINT sm_route_profitability_period_start_period_end_origin_airpo_key UNIQUE (period_start, period_end, origin_airport, dest_airport);


--
-- Name: sm_route_profitability sm_route_profitability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_route_profitability
    ADD CONSTRAINT sm_route_profitability_pkey PRIMARY KEY (id);


--
-- Name: sm_sales_channels sm_sales_channels_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_sales_channels
    ADD CONSTRAINT sm_sales_channels_code_key UNIQUE (code);


--
-- Name: sm_sales_channels sm_sales_channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_sales_channels
    ADD CONSTRAINT sm_sales_channels_pkey PRIMARY KEY (id);


--
-- Name: sm_seasonal_route_fare sm_seasonal_route_fare_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seasonal_route_fare
    ADD CONSTRAINT sm_seasonal_route_fare_pkey PRIMARY KEY (id);


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_pkey PRIMARY KEY (id);


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_unique UNIQUE (booking_id, flight_id, passenger_id);


--
-- Name: tickets tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_pkey PRIMARY KEY (id);


--
-- Name: tickets tickets_ticket_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_ticket_number_key UNIQUE (ticket_number);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_bookings_corporate; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_corporate ON public.bookings USING btree (corporate_account_id);


--
-- Name: idx_bookings_pnr; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_pnr ON public.bookings USING btree (pnr);


--
-- Name: idx_bookings_sales_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_sales_channel ON public.bookings USING btree (sales_channel_code);


--
-- Name: idx_bookings_travel_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bookings_travel_agent ON public.bookings USING btree (travel_agent_id);


--
-- Name: idx_checkins_flight_boarding_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_checkins_flight_boarding_seq ON public.checkins USING btree (flight_id, boarding_sequence);


--
-- Name: idx_checkins_flight_seat_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_checkins_flight_seat_uidx ON public.checkins USING btree (flight_id, upper(btrim((seat_number)::text))) WHERE ((seat_number IS NOT NULL) AND (btrim((seat_number)::text) <> ''::text));


--
-- Name: idx_crew_availability_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_availability_user ON public.crew_availability USING btree (user_id);


--
-- Name: idx_crew_documents_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_documents_user ON public.crew_documents USING btree (user_id);


--
-- Name: idx_crew_duty_logs_rest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_duty_logs_rest ON public.crew_duty_logs USING btree (user_id, rest_until);


--
-- Name: idx_crew_duty_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_duty_logs_user ON public.crew_duty_logs USING btree (user_id);


--
-- Name: idx_crew_licenses_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_licenses_user ON public.crew_licenses USING btree (user_id);


--
-- Name: idx_crew_medicals_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_medicals_user ON public.crew_medicals USING btree (user_id);


--
-- Name: idx_crew_training_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_crew_training_user ON public.crew_training USING btree (user_id);


--
-- Name: idx_cs_case_notes_case; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_case_notes_case ON public.cs_case_notes USING btree (case_id, created_at);


--
-- Name: idx_cs_cases_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_cases_assigned ON public.cs_service_cases USING btree (assigned_to);


--
-- Name: idx_cs_cases_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_cases_booking ON public.cs_service_cases USING btree (booking_id);


--
-- Name: idx_cs_cases_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_cases_created ON public.cs_service_cases USING btree (created_at DESC);


--
-- Name: idx_cs_cases_passenger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_cases_passenger ON public.cs_service_cases USING btree (passenger_id);


--
-- Name: idx_cs_cases_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_cases_status ON public.cs_service_cases USING btree (status);


--
-- Name: idx_cs_cases_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cs_cases_type ON public.cs_service_cases USING btree (case_type);


--
-- Name: idx_finance_expenses_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finance_expenses_flight ON public.finance_expenses USING btree (flight_id);


--
-- Name: idx_finance_expenses_incurred; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finance_expenses_incurred ON public.finance_expenses USING btree (incurred_on);


--
-- Name: idx_finance_txn_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finance_txn_booking ON public.finance_transactions USING btree (booking_id);


--
-- Name: idx_finance_txn_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finance_txn_created ON public.finance_transactions USING btree (created_at DESC);


--
-- Name: idx_finance_txn_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_finance_txn_type ON public.finance_transactions USING btree (txn_type);


--
-- Name: idx_flight_delays_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flight_delays_flight ON public.flight_delays USING btree (flight_id);


--
-- Name: idx_flights_checkin_closed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flights_checkin_closed_at ON public.flights USING btree (checkin_closed_at) WHERE (checkin_closed_at IS NOT NULL);


--
-- Name: idx_flights_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_flights_number ON public.flights USING btree (flight_number);


--
-- Name: idx_login_history_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_created ON public.login_history USING btree (created_at DESC);


--
-- Name: idx_login_history_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_login_history_email ON public.login_history USING btree (email);


--
-- Name: idx_maintenance_inspections_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_inspections_aircraft ON public.maintenance_inspections USING btree (aircraft_id);


--
-- Name: idx_maintenance_logs_aircraft; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_maintenance_logs_aircraft ON public.maintenance_logs USING btree (aircraft_id);


--
-- Name: idx_md_baggage_rules_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_md_baggage_rules_route ON public.md_baggage_rules USING btree (route_id);


--
-- Name: idx_md_route_fares_route; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_md_route_fares_route ON public.md_route_fares USING btree (route_id);


--
-- Name: idx_md_routes_dest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_md_routes_dest ON public.md_routes USING btree (dest_airport_id);


--
-- Name: idx_md_routes_origin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_md_routes_origin ON public.md_routes USING btree (origin_airport_id);


--
-- Name: idx_refund_requests_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_payment ON public.refund_requests USING btree (payment_id);


--
-- Name: idx_refund_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_refund_requests_status ON public.refund_requests USING btree (status);


--
-- Name: idx_sales_campaigns_dates; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_campaigns_dates ON public.sales_campaigns USING btree (start_date, end_date);


--
-- Name: idx_sales_leads_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_leads_campaign ON public.sales_leads USING btree (campaign_id);


--
-- Name: idx_sales_leads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_leads_status ON public.sales_leads USING btree (status);


--
-- Name: idx_sales_route_promos_promo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_route_promos_promo ON public.sales_route_promotions USING btree (promo_code_id);


--
-- Name: idx_sales_segment_members_passenger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_segment_members_passenger ON public.sales_segment_members USING btree (passenger_id);


--
-- Name: idx_sales_travel_agents_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_travel_agents_user ON public.sales_travel_agents USING btree (user_id);


--
-- Name: idx_sm_agent_commissions_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_agent_commissions_agent ON public.sm_agent_commissions USING btree (travel_agent_id);


--
-- Name: idx_sm_agent_commissions_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_agent_commissions_booking ON public.sm_agent_commissions USING btree (booking_id);


--
-- Name: idx_sm_ancillary_sales_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_ancillary_sales_booking ON public.sm_ancillary_sales USING btree (booking_id);


--
-- Name: idx_sm_crm_customers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_crm_customers_status ON public.sm_crm_customers USING btree (status);


--
-- Name: idx_sm_fare_rules_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_fare_rules_class ON public.sm_fare_rules USING btree (fare_class_id);


--
-- Name: idx_sm_loyalty_txn_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_loyalty_txn_account ON public.sm_loyalty_transactions USING btree (loyalty_account_id);


--
-- Name: idx_sm_rm_flight_bucket_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_rm_flight_bucket_flight ON public.sm_rm_flight_bucket USING btree (flight_id);


--
-- Name: idx_sm_seat_leg_allocation_booking; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_seat_leg_allocation_booking ON public.sm_seat_leg_allocation USING btree (booking_id);


--
-- Name: idx_sm_seat_leg_allocation_flight; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_seat_leg_allocation_flight ON public.sm_seat_leg_allocation USING btree (flight_id);


--
-- Name: idx_sm_seat_leg_allocation_passenger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_seat_leg_allocation_passenger ON public.sm_seat_leg_allocation USING btree (passenger_id);


--
-- Name: idx_sm_seat_leg_allocation_ticket; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sm_seat_leg_allocation_ticket ON public.sm_seat_leg_allocation USING btree (ticket_id);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_last_activity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_last_activity ON public.users USING btree (last_activity_at DESC NULLS LAST);


--
-- Name: idx_users_locked_until; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_locked_until ON public.users USING btree (locked_until) WHERE (locked_until IS NOT NULL);


--
-- Name: ops_routes_od_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ops_routes_od_uidx ON public.ops_routes USING btree (upper((origin_airport)::text), upper((dest_airport)::text));


--
-- Name: sales_promo_codes_code_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sales_promo_codes_code_uidx ON public.sales_promo_codes USING btree (upper((code)::text));


--
-- Name: sm_seat_leg_allocation trg_sm_seat_leg_allocation_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sm_seat_leg_allocation_updated BEFORE UPDATE ON public.sm_seat_leg_allocation FOR EACH ROW EXECUTE FUNCTION public.sm_seat_leg_allocation_touch_updated_at();


--
-- Name: aircraft aircraft_aircraft_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aircraft
    ADD CONSTRAINT aircraft_aircraft_type_id_fkey FOREIGN KEY (aircraft_type_id) REFERENCES public.md_aircraft_types(id);


--
-- Name: aircraft aircraft_seat_map_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.aircraft
    ADD CONSTRAINT aircraft_seat_map_id_fkey FOREIGN KEY (seat_map_id) REFERENCES public.md_seat_maps(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: baggage baggage_checkin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.baggage
    ADD CONSTRAINT baggage_checkin_id_fkey FOREIGN KEY (checkin_id) REFERENCES public.checkins(id) ON DELETE CASCADE;


--
-- Name: booking_flights booking_flights_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_flights
    ADD CONSTRAINT booking_flights_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_flights booking_flights_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_flights
    ADD CONSTRAINT booking_flights_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id);


--
-- Name: booking_flights booking_flights_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_flights
    ADD CONSTRAINT booking_flights_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id);


--
-- Name: booking_passengers booking_passengers_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_passengers
    ADD CONSTRAINT booking_passengers_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: booking_passengers booking_passengers_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.booking_passengers
    ADD CONSTRAINT booking_passengers_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id);


--
-- Name: bookings bookings_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.sales_campaigns(id);


--
-- Name: bookings bookings_corporate_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_corporate_account_id_fkey FOREIGN KEY (corporate_account_id) REFERENCES public.sales_corporate_customers(id);


--
-- Name: bookings bookings_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: bookings bookings_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES public.sales_promo_codes(id);


--
-- Name: bookings bookings_travel_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bookings
    ADD CONSTRAINT bookings_travel_agent_id_fkey FOREIGN KEY (travel_agent_id) REFERENCES public.sales_travel_agents(id);


--
-- Name: checkins checkins_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: checkins checkins_checked_in_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_checked_in_by_fkey FOREIGN KEY (checked_in_by) REFERENCES public.users(id);


--
-- Name: checkins checkins_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id);


--
-- Name: checkins checkins_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id);


--
-- Name: crew_assignments crew_assignments_crew_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_assignments
    ADD CONSTRAINT crew_assignments_crew_user_id_fkey FOREIGN KEY (crew_user_id) REFERENCES public.users(id);


--
-- Name: crew_assignments crew_assignments_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_assignments
    ADD CONSTRAINT crew_assignments_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id) ON DELETE CASCADE;


--
-- Name: crew_availability crew_availability_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_availability
    ADD CONSTRAINT crew_availability_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crew_documents crew_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_documents
    ADD CONSTRAINT crew_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crew_duty_logs crew_duty_logs_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_duty_logs
    ADD CONSTRAINT crew_duty_logs_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id) ON DELETE CASCADE;


--
-- Name: crew_duty_logs crew_duty_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_duty_logs
    ADD CONSTRAINT crew_duty_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crew_licenses crew_licenses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_licenses
    ADD CONSTRAINT crew_licenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crew_medicals crew_medicals_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_medicals
    ADD CONSTRAINT crew_medicals_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crew_profiles crew_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_profiles
    ADD CONSTRAINT crew_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: crew_training crew_training_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.crew_training
    ADD CONSTRAINT crew_training_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cs_case_notes cs_case_notes_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_case_notes
    ADD CONSTRAINT cs_case_notes_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.cs_service_cases(id) ON DELETE CASCADE;


--
-- Name: cs_case_notes cs_case_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_case_notes
    ADD CONSTRAINT cs_case_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: cs_customer_profiles cs_customer_profiles_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_customer_profiles
    ADD CONSTRAINT cs_customer_profiles_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id) ON DELETE CASCADE;


--
-- Name: cs_service_cases cs_service_cases_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: cs_service_cases cs_service_cases_baggage_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_baggage_id_fkey FOREIGN KEY (baggage_id) REFERENCES public.baggage(id);


--
-- Name: cs_service_cases cs_service_cases_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: cs_service_cases cs_service_cases_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: cs_service_cases cs_service_cases_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id);


--
-- Name: cs_service_cases cs_service_cases_refund_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cs_service_cases
    ADD CONSTRAINT cs_service_cases_refund_request_id_fkey FOREIGN KEY (refund_request_id) REFERENCES public.refund_requests(id);


--
-- Name: dispatch_logs dispatch_logs_dispatched_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_logs
    ADD CONSTRAINT dispatch_logs_dispatched_by_fkey FOREIGN KEY (dispatched_by) REFERENCES public.users(id);


--
-- Name: dispatch_logs dispatch_logs_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dispatch_logs
    ADD CONSTRAINT dispatch_logs_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id);


--
-- Name: finance_expenses finance_expenses_entered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_entered_by_fkey FOREIGN KEY (entered_by) REFERENCES public.users(id);


--
-- Name: finance_expenses finance_expenses_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_expenses
    ADD CONSTRAINT finance_expenses_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id);


--
-- Name: finance_transactions finance_transactions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: finance_transactions finance_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: finance_transactions finance_transactions_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.finance_expenses(id);


--
-- Name: finance_transactions finance_transactions_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: finance_transactions finance_transactions_refund_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_refund_id_fkey FOREIGN KEY (refund_id) REFERENCES public.refunds(id);


--
-- Name: finance_transactions finance_transactions_refund_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.finance_transactions
    ADD CONSTRAINT finance_transactions_refund_request_id_fkey FOREIGN KEY (refund_request_id) REFERENCES public.refund_requests(id);


--
-- Name: flight_delays flight_delays_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_delays
    ADD CONSTRAINT flight_delays_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id) ON DELETE CASCADE;


--
-- Name: flight_delays flight_delays_reported_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flight_delays
    ADD CONSTRAINT flight_delays_reported_by_fkey FOREIGN KEY (reported_by) REFERENCES public.users(id);


--
-- Name: flights flights_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flights
    ADD CONSTRAINT flights_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aircraft(id);


--
-- Name: flights flights_checkin_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flights
    ADD CONSTRAINT flights_checkin_closed_by_fkey FOREIGN KEY (checkin_closed_by) REFERENCES public.users(id);


--
-- Name: flights flights_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flights
    ADD CONSTRAINT flights_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: flights flights_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.flights
    ADD CONSTRAINT flights_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.ops_routes(id) ON DELETE SET NULL;


--
-- Name: login_history login_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: maintenance_inspections maintenance_inspections_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_inspections
    ADD CONSTRAINT maintenance_inspections_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aircraft(id) ON DELETE CASCADE;


--
-- Name: maintenance_inspections maintenance_inspections_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_inspections
    ADD CONSTRAINT maintenance_inspections_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.users(id);


--
-- Name: maintenance_inspections maintenance_inspections_scheduled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_inspections
    ADD CONSTRAINT maintenance_inspections_scheduled_by_fkey FOREIGN KEY (scheduled_by) REFERENCES public.users(id);


--
-- Name: maintenance_logs maintenance_logs_aircraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_aircraft_id_fkey FOREIGN KEY (aircraft_id) REFERENCES public.aircraft(id);


--
-- Name: maintenance_logs maintenance_logs_closed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_closed_by_fkey FOREIGN KEY (closed_by) REFERENCES public.users(id);


--
-- Name: maintenance_logs maintenance_logs_opened_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_opened_by_fkey FOREIGN KEY (opened_by) REFERENCES public.users(id);


--
-- Name: md_airports md_airports_city_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_airports
    ADD CONSTRAINT md_airports_city_id_fkey FOREIGN KEY (city_id) REFERENCES public.md_cities(id);


--
-- Name: md_airports md_airports_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_airports
    ADD CONSTRAINT md_airports_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.md_countries(id);


--
-- Name: md_baggage_rules md_baggage_rules_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_baggage_rules
    ADD CONSTRAINT md_baggage_rules_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE SET NULL;


--
-- Name: md_baggage_rules md_baggage_rules_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_baggage_rules
    ADD CONSTRAINT md_baggage_rules_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.md_routes(id) ON DELETE CASCADE;


--
-- Name: md_cities md_cities_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_cities
    ADD CONSTRAINT md_cities_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.md_countries(id) ON DELETE CASCADE;


--
-- Name: md_departments md_departments_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_departments
    ADD CONSTRAINT md_departments_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.md_departments(id) ON DELETE SET NULL;


--
-- Name: md_route_fares md_route_fares_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_route_fares
    ADD CONSTRAINT md_route_fares_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE CASCADE;


--
-- Name: md_route_fares md_route_fares_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_route_fares
    ADD CONSTRAINT md_route_fares_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.md_routes(id) ON DELETE CASCADE;


--
-- Name: md_routes md_routes_dest_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_routes
    ADD CONSTRAINT md_routes_dest_airport_id_fkey FOREIGN KEY (dest_airport_id) REFERENCES public.md_airports(id) ON DELETE RESTRICT;


--
-- Name: md_routes md_routes_origin_airport_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_routes
    ADD CONSTRAINT md_routes_origin_airport_id_fkey FOREIGN KEY (origin_airport_id) REFERENCES public.md_airports(id) ON DELETE RESTRICT;


--
-- Name: md_seat_maps md_seat_maps_aircraft_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.md_seat_maps
    ADD CONSTRAINT md_seat_maps_aircraft_type_id_fkey FOREIGN KEY (aircraft_type_id) REFERENCES public.md_aircraft_types(id) ON DELETE CASCADE;


--
-- Name: payments payments_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: payments payments_processed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_processed_by_fkey FOREIGN KEY (processed_by) REFERENCES public.users(id);


--
-- Name: refund_requests refund_requests_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: refund_requests refund_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id);


--
-- Name: refund_requests refund_requests_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refund_requests
    ADD CONSTRAINT refund_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.users(id);


--
-- Name: refunds refunds_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id);


--
-- Name: refunds refunds_refund_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_refund_request_id_fkey FOREIGN KEY (refund_request_id) REFERENCES public.refund_requests(id);


--
-- Name: sales_campaigns sales_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_campaigns
    ADD CONSTRAINT sales_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: sales_leads sales_leads_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_leads
    ADD CONSTRAINT sales_leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id);


--
-- Name: sales_leads sales_leads_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_leads
    ADD CONSTRAINT sales_leads_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.sales_campaigns(id);


--
-- Name: sales_route_promotions sales_route_promotions_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_route_promotions
    ADD CONSTRAINT sales_route_promotions_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES public.sales_promo_codes(id) ON DELETE CASCADE;


--
-- Name: sales_segment_members sales_segment_members_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_segment_members
    ADD CONSTRAINT sales_segment_members_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id) ON DELETE CASCADE;


--
-- Name: sales_segment_members sales_segment_members_segment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_segment_members
    ADD CONSTRAINT sales_segment_members_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES public.sales_customer_segments(id) ON DELETE CASCADE;


--
-- Name: sales_travel_agents sales_travel_agents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_travel_agents
    ADD CONSTRAINT sales_travel_agents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: sm_agent_commissions sm_agent_commissions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_agent_commissions
    ADD CONSTRAINT sm_agent_commissions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: sm_agent_commissions sm_agent_commissions_channel_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_agent_commissions
    ADD CONSTRAINT sm_agent_commissions_channel_code_fkey FOREIGN KEY (channel_code) REFERENCES public.sm_sales_channels(code);


--
-- Name: sm_agent_commissions sm_agent_commissions_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_agent_commissions
    ADD CONSTRAINT sm_agent_commissions_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;


--
-- Name: sm_agent_commissions sm_agent_commissions_travel_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_agent_commissions
    ADD CONSTRAINT sm_agent_commissions_travel_agent_id_fkey FOREIGN KEY (travel_agent_id) REFERENCES public.sales_travel_agents(id);


--
-- Name: sm_ancillary_sales sm_ancillary_sales_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_ancillary_sales
    ADD CONSTRAINT sm_ancillary_sales_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: sm_ancillary_sales sm_ancillary_sales_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_ancillary_sales
    ADD CONSTRAINT sm_ancillary_sales_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: sm_ancillary_sales sm_ancillary_sales_product_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_ancillary_sales
    ADD CONSTRAINT sm_ancillary_sales_product_code_fkey FOREIGN KEY (product_code) REFERENCES public.sm_ancillary_products(code);


--
-- Name: sm_automation_rules sm_automation_rules_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_automation_rules
    ADD CONSTRAINT sm_automation_rules_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.sales_campaigns(id);


--
-- Name: sm_commission_rules sm_commission_rules_channel_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_commission_rules
    ADD CONSTRAINT sm_commission_rules_channel_code_fkey FOREIGN KEY (channel_code) REFERENCES public.sm_sales_channels(code);


--
-- Name: sm_commission_rules sm_commission_rules_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_commission_rules
    ADD CONSTRAINT sm_commission_rules_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES public.sales_promo_codes(id);


--
-- Name: sm_corporate_contracts sm_corporate_contracts_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_corporate_contracts
    ADD CONSTRAINT sm_corporate_contracts_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.sales_corporate_customers(id) ON DELETE CASCADE;


--
-- Name: sm_corporate_travelers sm_corporate_travelers_corporate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_corporate_travelers
    ADD CONSTRAINT sm_corporate_travelers_corporate_id_fkey FOREIGN KEY (corporate_id) REFERENCES public.sales_corporate_customers(id) ON DELETE CASCADE;


--
-- Name: sm_corporate_travelers sm_corporate_travelers_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_corporate_travelers
    ADD CONSTRAINT sm_corporate_travelers_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id) ON DELETE CASCADE;


--
-- Name: sm_crm_customers sm_crm_customers_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_crm_customers
    ADD CONSTRAINT sm_crm_customers_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id) ON DELETE CASCADE;


--
-- Name: sm_fare_class_family_map sm_fare_class_family_map_family_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_class_family_map
    ADD CONSTRAINT sm_fare_class_family_map_family_id_fkey FOREIGN KEY (family_id) REFERENCES public.sm_fare_families(id) ON DELETE CASCADE;


--
-- Name: sm_fare_class_family_map sm_fare_class_family_map_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_class_family_map
    ADD CONSTRAINT sm_fare_class_family_map_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE CASCADE;


--
-- Name: sm_fare_rules sm_fare_rules_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_rules
    ADD CONSTRAINT sm_fare_rules_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE CASCADE;


--
-- Name: sm_fare_rules sm_fare_rules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_fare_rules
    ADD CONSTRAINT sm_fare_rules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: sm_lead_followups sm_lead_followups_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_lead_followups
    ADD CONSTRAINT sm_lead_followups_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.sales_leads(id) ON DELETE CASCADE;


--
-- Name: sm_loyalty_accounts sm_loyalty_accounts_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_loyalty_accounts
    ADD CONSTRAINT sm_loyalty_accounts_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id) ON DELETE CASCADE;


--
-- Name: sm_loyalty_transactions sm_loyalty_transactions_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_loyalty_transactions
    ADD CONSTRAINT sm_loyalty_transactions_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: sm_loyalty_transactions sm_loyalty_transactions_loyalty_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_loyalty_transactions
    ADD CONSTRAINT sm_loyalty_transactions_loyalty_account_id_fkey FOREIGN KEY (loyalty_account_id) REFERENCES public.sm_loyalty_accounts(id) ON DELETE CASCADE;


--
-- Name: sm_promo_usage sm_promo_usage_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_promo_usage
    ADD CONSTRAINT sm_promo_usage_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: sm_promo_usage sm_promo_usage_promo_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_promo_usage
    ADD CONSTRAINT sm_promo_usage_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES public.sales_promo_codes(id) ON DELETE CASCADE;


--
-- Name: sm_rm_flight_bucket sm_rm_flight_bucket_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_rm_flight_bucket
    ADD CONSTRAINT sm_rm_flight_bucket_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE CASCADE;


--
-- Name: sm_rm_flight_bucket sm_rm_flight_bucket_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_rm_flight_bucket
    ADD CONSTRAINT sm_rm_flight_bucket_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id) ON DELETE CASCADE;


--
-- Name: sm_seasonal_route_fare sm_seasonal_route_fare_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seasonal_route_fare
    ADD CONSTRAINT sm_seasonal_route_fare_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE SET NULL;


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_fare_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_fare_class_id_fkey FOREIGN KEY (fare_class_id) REFERENCES public.md_fare_classes(id) ON DELETE SET NULL;


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_flight_id_fkey FOREIGN KEY (flight_id) REFERENCES public.flights(id) ON DELETE CASCADE;


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id) ON DELETE CASCADE;


--
-- Name: sm_seat_leg_allocation sm_seat_leg_allocation_ticket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sm_seat_leg_allocation
    ADD CONSTRAINT sm_seat_leg_allocation_ticket_id_fkey FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE CASCADE;


--
-- Name: tickets tickets_booking_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id);


--
-- Name: tickets tickets_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_issued_by_fkey FOREIGN KEY (issued_by) REFERENCES public.users(id);


--
-- Name: tickets tickets_passenger_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tickets
    ADD CONSTRAINT tickets_passenger_id_fkey FOREIGN KEY (passenger_id) REFERENCES public.passengers(id);


--
-- PostgreSQL database dump complete
--

\unrestrict SohRs4jLGeVJha1OFj8OOTLtPTcZ1GV9KJQrz7wuuvAtJbU4LYWSxF7Q7at2wmh

